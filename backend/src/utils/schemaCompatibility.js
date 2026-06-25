/**
 * schemaCompatibility.js
 * ----------------------
 * Idempotent startup-time schema compatibility checks.
 *
 * This project uses sequelize.sync() on boot (without a migration runner).
 * Some schema changes — especially MySQL ENUM evolution and legacy columns —
 * can drift in existing developer databases. These helpers reconcile only
 * missing/incorrect pieces and do nothing when schema is already compatible.
 *
 * ## Safe rollout toggle
 * Set ENABLE_SCHEMA_COMPAT=false in your environment to disable ALL schema
 * reconciliation without a code revert. Useful for emergency rollback if a
 * reconciliation step behaves unexpectedly on a specific database.
 * Default: enabled (runs on every startup after sequelize.sync()).
 *
 * ## Deprecation notice
 * The manual terminal command `ALTER TABLE userAccount MODIFY accountStatus ENUM(...)`
 * previously documented in userAccount.js is DEPRECATED and must NOT be used.
 * Schema reconciliation is now owned exclusively by this helper, called automatically
 * by index.js after sequelize.sync(). Do not add ad-hoc ALTER commands.
 *
 * ## Adding new reconciliations
 * 1. Add a guarded check function below (INFORMATION_SCHEMA → only act when needed).
 * 2. Data-backfill FIRST if your change could reject existing row values (e.g. ENUM
 *    shrink, NOT NULL without DEFAULT). Normalize stale values → valid member → then DDL.
 * 3. Register it in ensureSchemaCompatibility() and push a result token to `results`.
 * 4. The single structured log line at the end is emitted automatically.
 */

/**
 * Quotes a MySQL identifier safely (backtick-escapes any embedded backticks).
 *
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, "``")}\``;
}

/**
 * Reads a single INFORMATION_SCHEMA column record for the current database.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {string} tableName
 * @param {string} columnName
 * @returns {Promise<{ columnType: string } | null>}
 */
async function getColumnMetadata(sequelize, tableName, columnName) {
  const [rows] = await sequelize.query(
    `
      SELECT COLUMN_TYPE AS columnType
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = :tableName
        AND COLUMN_NAME  = :columnName
      LIMIT 1
    `,
    { replacements: { tableName, columnName } }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Ensures a column exists on a table; no-ops when the column is already present.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {string} tableName
 * @param {string} columnName
 * @param {string} columnDefinition  SQL snippet after the column name, e.g. "LONGTEXT NULL"
 * @returns {Promise<"applied"|"skipped">}
 */
async function ensureColumnExists(sequelize, tableName, columnName, columnDefinition) {
  const existing = await getColumnMetadata(sequelize, tableName, columnName);
  if (existing) return "skipped";

  await sequelize.query(
    `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDefinition}`
  );
  return "applied";
}

/**
 * Ensures the userAccount.accountStatus ENUM includes BANNED (and the full canonical set).
 *
 * Safety steps (order matters):
 *   1. Backfill — UPDATE any rows whose accountStatus is outside the target set to 'ACTIVE'
 *      before the MODIFY, so MySQL cannot truncate or error on existing data.
 *   2. DDL — only MODIFY when the ENUM definition is still missing 'BANNED'; no-op otherwise.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {Promise<"applied"|"skipped">}
 */
async function ensureAccountStatusEnum(sequelize) {
  const metadata = await getColumnMetadata(sequelize, "userAccount", "accountStatus");
  const enumDefinition = String(metadata?.columnType || "").toUpperCase();

  // Already includes BANNED — nothing to do.
  if (enumDefinition.includes("'BANNED'")) return "skipped";

  // Step 1 — backfill: normalize any out-of-set values before modifying the ENUM.
  // Prevents "Data truncated for column 'accountStatus'" errors on tightened ENUM sets.
  await sequelize.query(
    `
      UPDATE ${quoteIdentifier("userAccount")}
      SET    ${quoteIdentifier("accountStatus")} = 'ACTIVE'
      WHERE  ${quoteIdentifier("accountStatus")} NOT IN ('ACTIVE','SUSPENDED','DEACTIVATED','BANNED')
    `
  );

  // Step 2 — DDL: add BANNED to the ENUM.
  await sequelize.query(
    `
      ALTER TABLE ${quoteIdentifier("userAccount")}
      MODIFY COLUMN ${quoteIdentifier("accountStatus")}
      ENUM('ACTIVE','SUSPENDED','DEACTIVATED','BANNED')
      NOT NULL DEFAULT 'ACTIVE'
    `
  );

  return "applied";
}

/**
 * Ensures the userAccount.userRole ENUM includes MODERATOR and excludes the
 * removed SYSTEM_ADMIN role (NGO_ADMIN is now the only admin role).
 *
 * Safety steps (order matters):
 *   1. Backfill — any existing SYSTEM_ADMIN rows are reassigned to NGO_ADMIN
 *      before the MODIFY, so MySQL cannot reject/truncate them when the ENUM
 *      shrinks.
 *   2. DDL — only runs when the ENUM doesn't already match the target set.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {Promise<"applied"|"skipped">}
 */
async function ensureUserRoleEnum(sequelize) {
  const metadata = await getColumnMetadata(sequelize, "userAccount", "userRole");
  const enumDefinition = String(metadata?.columnType || "").toUpperCase();

  const alreadyTarget = enumDefinition.includes("'MODERATOR'") && !enumDefinition.includes("'SYSTEM_ADMIN'");
  if (alreadyTarget) return "skipped";

  // Step 1 — backfill: reassign any SYSTEM_ADMIN accounts to NGO_ADMIN before
  // the ENUM narrows, so MySQL cannot reject existing rows.
  await sequelize.query(
    `
      UPDATE ${quoteIdentifier("userAccount")}
      SET    ${quoteIdentifier("userRole")} = 'NGO_ADMIN'
      WHERE  ${quoteIdentifier("userRole")} = 'SYSTEM_ADMIN'
    `
  );

  // Step 2 — DDL: set the ENUM to the current canonical role set.
  await sequelize.query(
    `
      ALTER TABLE ${quoteIdentifier("userAccount")}
      MODIFY COLUMN ${quoteIdentifier("userRole")}
      ENUM('SURVIVOR','COUNSELLOR','LEGAL_COUNSEL','NGO_ADMIN','MODERATOR')
      NOT NULL DEFAULT 'SURVIVOR'
    `
  );

  return "applied";
}

/**
 * Reconciles known compatibility columns and enum definitions on every startup.
 * Safe to run after sequelize.sync() — all checks are guarded by INFORMATION_SCHEMA
 * lookups and are idempotent (no-op when schema is already up-to-date).
 *
 * Emits one structured log line per boot summarising what was checked / applied /
 * skipped so schema drift is immediately visible in server logs.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {Promise<void>}
 */
async function ensureSchemaCompatibility(sequelize) {
  // Respect the emergency rollback toggle. When disabled, log clearly and exit.
  if (process.env.ENABLE_SCHEMA_COMPAT === "false") {
    console.log(
      "[schema-compat] disabled via ENABLE_SCHEMA_COMPAT=false — no schema changes applied."
    );
    return;
  }

  const results = [];

  // ── Column: userAccount.ecdhPublicKey ──────────────────────────────────────
  // Stores the user's ECDH P-256 public key for genuine E2EE key exchange.
  const ecdhPublicKey = await ensureColumnExists(
    sequelize, "userAccount", "ecdhPublicKey", "LONGTEXT NULL"
  );
  results.push(`ecdhPublicKey=${ecdhPublicKey}`);

  // ── Column: userAccount.banReason ─────────────────────────────────────────
  const banReason = await ensureColumnExists(
    sequelize, "userAccount", "banReason", "TEXT NULL"
  );
  results.push(`banReason=${banReason}`);

  // ── Column: userAccount.bannedAt ──────────────────────────────────────────
  const bannedAt = await ensureColumnExists(
    sequelize, "userAccount", "bannedAt", "DATETIME NULL"
  );
  results.push(`bannedAt=${bannedAt}`);

  // ── Column: userAccount.banExpiresAt ──────────────────────────────────────
  const banExpiresAt = await ensureColumnExists(
    sequelize, "userAccount", "banExpiresAt", "DATETIME NULL"
  );
  results.push(`banExpiresAt=${banExpiresAt}`);

  // ── Column: userAccount.bannedByUserId ────────────────────────────────────
  const bannedByUserId = await ensureColumnExists(
    sequelize, "userAccount", "bannedByUserId", "VARCHAR(36) NULL"
  );
  results.push(`bannedByUserId=${bannedByUserId}`);

  // ── ENUM: userAccount.accountStatus must include BANNED ───────────────────
  // Runs a backfill step before the DDL to avoid data-truncation errors.
  // See ensureAccountStatusEnum() for details.
  const accountStatusEnum = await ensureAccountStatusEnum(sequelize);
  results.push(`accountStatus.ENUM=${accountStatusEnum}`);

  // ── ENUM: userAccount.userRole must include MODERATOR ─────────────────────
  const userRoleEnum = await ensureUserRoleEnum(sequelize);
  results.push(`userRole.ENUM=${userRoleEnum}`);

  // ── Column: ussdCallbackRequest.assignedCounsellorId ──────────────────────
  const assignedCounsellorId = await ensureColumnExists(
    sequelize, "ussdCallbackRequest", "assignedCounsellorId", "VARCHAR(36) NULL"
  );
  results.push(`assignedCounsellorId=${assignedCounsellorId}`);

  // ── Column: inAppNotification.relatedEntityType ───────────────────────────
  // Lets the notification panel link back to the chat/report/room/callback
  // that triggered it instead of just showing a discreet message with no target.
  const relatedEntityType = await ensureColumnExists(
    sequelize, "inAppNotification", "relatedEntityType", "VARCHAR(30) NULL"
  );
  results.push(`relatedEntityType=${relatedEntityType}`);

  // ── Column: inAppNotification.relatedEntityId ──────────────────────────────
  const relatedEntityId = await ensureColumnExists(
    sequelize, "inAppNotification", "relatedEntityId", "VARCHAR(36) NULL"
  );
  results.push(`relatedEntityId=${relatedEntityId}`);

  // Single structured log line for observability.
  // Each token is "name=applied|skipped". "applied" means a change was made;
  // "skipped" means the schema was already correct (the common steady-state path).
  console.log(`[schema-compat] ${results.join(" | ")}`);
}

module.exports = {
  ensureSchemaCompatibility
};
