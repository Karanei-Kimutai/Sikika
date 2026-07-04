# Server Boot Process

This document describes exactly what happens when the backend server starts — from the first line of `index.js` to the moment it begins accepting HTTP traffic. Every step is sequential; if any step fails, the process exits immediately with a descriptive error message.

Entry point: `backend/index.js`

---

## Boot Sequence at a Glance

```
1. Proxy cleanup
2. Express + Socket.io initialisation
3. Middleware + route mounting
4. validateEnv()           — fail fast on missing/invalid config
5. ensureDatabaseExists()  — CREATE DATABASE IF NOT EXISTS
6. sequelize.authenticate() — verify DB connection
7. sequelize.sync()        — create/alter tables from model definitions
8. ensureSchemaCompatibility() — idempotent DDL guards for drift
9. loadMaintenanceStateFromDb() — restore durable settings
10. server.listen()         — begin accepting traffic
```

---

## Step 1 — Proxy Cleanup

```js
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", ...]) {
    if (process.env[key] === "http://127.0.0.1:9") {
        delete process.env[key];
    }
}
```

Some local environments (notably WSL and certain IDEs) inject proxy variables pointing to `http://127.0.0.1:9` — an address with nothing listening on it. If these are left in the environment, the Africa's Talking SDK and other HTTP clients will try to route their requests through that dead proxy and fail.

This runs before anything else so no SDK or library is initialised with bad proxy settings.

---

## Step 2 — Express + Socket.io Initialisation

```js
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: frontendOrigin } });
```

Express is wrapped in a standard Node `http.Server` rather than calling `app.listen()` directly. This is necessary because Socket.io must attach to the HTTP server instance — not to Express — so that both REST requests and WebSocket connections share the same port (5000).

`FRONTEND_ORIGIN` (from `.env`) is applied as the CORS `origin` for both Express and Socket.io at this point. Only requests from that origin are accepted.

The two socket handlers are initialised immediately:

- **`chatSocket(io)`** — JWT-authenticated; handles direct (E2EE) messaging, presence tracking, and delivery receipts.
- **`communitySocket(io)`** — handles community room join/leave and real-time message broadcast.

The Socket.io instance is stored on `app.locals.io` and also handed to `notificationService` via `setNotificationIo(io)` so that controllers can push real-time notifications to connected users without importing the socket layer directly.

---

## Step 3 — Middleware + Route Mounting

The following are applied in order before `startServer()` runs:

| Order | Middleware / Mount | Purpose |
|-------|--------------------|---------|
| 1 | `cors()` | Enforce the `FRONTEND_ORIGIN` allowlist on every request. |
| 2 | `express.json()` | Parse JSON request bodies into `req.body`. |
| 3 | `express.urlencoded()` | Parse URL-encoded form bodies (used by USSD callback). |
| 4 | `maintenanceGuard` | Block all non-admin traffic with HTTP 503 when maintenance mode is active. Applied globally before any business routes. |
| 5 | Route files | All API route modules are mounted (see table below). |

**Mounted routes:**

| Prefix | Module |
|--------|--------|
| `/api/auth` | `authRoutes` |
| `/api/resources` | `resourceRoutes` |
| `/api/chat` | `chatRoutes` |
| `/api/reports` | `reportRoutes` |
| `/api/community` | `communityRoutes` |
| `/api/admin` | `adminRoutes` |
| `/api/profile` | `profileRoutes` |
| `/api/reassignment-requests` | `reassignmentRequestRoutes` |
| `/api/ussd` | `ussdRoutes` |
| `/api/notifications` | `notificationRoutes` |
| `/api/legal-cases` | `legalCaseRoutes` |

Three utility endpoints are also registered inline (not in route files):

- `GET /api/hello` — smoke test; returns `{ message: "Hello from Express backend!" }`.
- `GET /api/health` — confirms Express is reachable; returns `{ status: "ok" }`.
- `GET /api/health/db` — confirms MySQL is reachable via Sequelize; returns `{ status: "ok", database: "CSProjectDB" }`.
- `GET /api/system/public-status` — public endpoint polled by the frontend every 15 seconds to check maintenance mode state.
- `GET /api/auth/session` — JWT-authenticated; returns the decoded session payload from `req.user`.

Route and middleware mounting happens **before** `startServer()` is called. This means Express is fully configured with all routes in memory before the database is connected. Incoming requests during the boot window are buffered by the OS until `server.listen()` is called in step 10.

---

## Step 4 — `validateEnv()`

```js
const requiredEnv = [
    "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER",
    "AFRICASTALKING_API_KEY", "AFRICASTALKING_USERNAME", "JWT_SECRET"
];
```

All required environment variables are checked for presence. If any are missing, the process throws immediately with a list of the missing keys. This is a deliberate fail-fast: it is easier to debug a missing config before the server starts than to trace an error that surfaces later during a request.

Two additional production safety rules are enforced when `NODE_ENV=production`:

| Rule | Reason |
|------|--------|
| `AFRICASTALKING_USERNAME` cannot be `"sandbox"` | Prevents accidentally routing production OTPs to the AT sandbox where they are never delivered. |
| `SKIP_SMS_IN_DEV` cannot be `"true"` | Prevents OTPs from being exposed in production API responses. |

If either rule is violated in production, the process exits before opening the port.

---

## Step 5 — `ensureDatabaseExists()`

```js
await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`CSProjectDB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
```

A raw MySQL connection is opened directly to the MySQL server (not to any specific database) using `mysql2/promise`. It runs `CREATE DATABASE IF NOT EXISTS` and then closes the connection.

This step exists so developers never have to manually create the database before starting the backend for the first time. The database name is taken from `DB_NAME` in `.env`. The identifier is backtick-escaped by `quoteIdentifier()` to prevent SQL injection via the env var.

If MySQL rejects the connection at this point (wrong credentials, MySQL not running, etc.), the catch block prints a targeted hint: `"Check DB_USER and DB_PASSWORD in backend/.env. MySQL rejected these credentials."` before exiting.

---

## Step 6 — `sequelize.authenticate()`

```js
await db.sequelize.authenticate();
```

Sequelize opens its connection pool to `CSProjectDB` and runs a lightweight `SELECT 1` query to confirm it can communicate with the database. Logs: `"Database connected successfully!"`.

This is a separate step from step 5 — `ensureDatabaseExists` uses a raw `mysql2` connection with no database selected, while Sequelize needs the database to already exist before it can connect to it.

---

## Step 7 — `sequelize.sync()`

```js
const enableAlterSync = process.env.DB_SYNC_ALTER === "true";
await db.sequelize.sync(enableAlterSync ? { alter: true } : undefined);
```

Sequelize reads all registered model definitions and reconciles them against the live database:

| Mode | Behaviour |
|------|-----------|
| Default (`DB_SYNC_ALTER=false`) | Creates tables that do not yet exist. Does not modify existing tables. Safe on every boot. |
| Alter mode (`DB_SYNC_ALTER=true`) | Also alters existing columns and indexes to match model definitions. Riskier — can hit MySQL's max-key limits on repeated runs against the same database. Set to `true` once to apply a schema change, then revert. |
| `{ force: true }` (not used in boot) | Drops and recreates all tables. Destroys all data. Only available via `src/sync.js` and only for development resets. |

Alter mode is off by default because repeatedly running it against a development database that has accumulated many indexes can eventually hit MySQL's per-table key limit and fail.

Logs: `"Database tables synced successfully!"`.

---

## Step 8 — `ensureSchemaCompatibility()`

File: `backend/src/utils/schemaCompatibility.js`

```js
await ensureSchemaCompatibility(db.sequelize);
```

`sequelize.sync()` handles table creation but handles ENUM evolution poorly — adding a new ENUM value to a column that already has rows can cause MySQL to error or truncate data if any existing row holds a value outside the new set. `ensureSchemaCompatibility` runs after sync to handle these cases safely.

Can be disabled entirely with `ENABLE_SCHEMA_COMPAT=false` in `.env` as an emergency rollback toggle — no code change required.

### How it works

Each check follows the same pattern:

1. **Query `INFORMATION_SCHEMA.COLUMNS`** for the current state of the column. This makes every check idempotent — it only acts when the schema is actually out of date.
2. **Backfill first** (for ENUM changes) — `UPDATE` any rows whose value is outside the target ENUM set to a safe default (`'ACTIVE'`) before running the DDL. This prevents `"Data truncated for column"` errors.
3. **Run the DDL** — `ALTER TABLE ... MODIFY COLUMN` or `ADD COLUMN`.

### Checks registered on every boot

| Check | Table | Column | Action when needed |
|-------|-------|--------|--------------------|
| `ecdhPublicKey` | `userAccount` | `ecdhPublicKey` | `ADD COLUMN LONGTEXT NULL` |
| `banReason` | `userAccount` | `banReason` | `ADD COLUMN TEXT NULL` |
| `bannedAt` | `userAccount` | `bannedAt` | `ADD COLUMN DATETIME NULL` |
| `banExpiresAt` | `userAccount` | `banExpiresAt` | `ADD COLUMN DATETIME NULL` |
| `bannedByUserId` | `userAccount` | `bannedByUserId` | `ADD COLUMN VARCHAR(36) NULL` |
| `accountStatus` ENUM | `userAccount` | `accountStatus` | Backfill out-of-set rows → `ACTIVE`, then `MODIFY COLUMN ENUM('ACTIVE','SUSPENDED','DEACTIVATED','BANNED')` |

Each check reports `"applied"` (change was made) or `"skipped"` (schema was already correct). A single structured log line is emitted at the end:

```
[schema-compat] ecdhPublicKey=skipped | banReason=skipped | bannedAt=skipped | banExpiresAt=skipped | bannedByUserId=skipped | accountStatus.ENUM=skipped
```

In steady state (schema already up to date), every token reads `skipped`. A token reading `applied` means the database for that environment was behind and was just patched.

### Adding a new reconciliation step

When a schema change cannot be safely handled by `sequelize.sync()` alone:

1. Add a guarded check function in `schemaCompatibility.js` (query `INFORMATION_SCHEMA` first, only act when needed).
2. If the change could reject existing row values (ENUM shrink, NOT NULL without DEFAULT), add a data-backfill `UPDATE` before the DDL.
3. Register it in `ensureSchemaCompatibility()` and push a result token to `results`.

Do not run manual `ALTER TABLE` commands in the terminal — they are not repeatable and won't run for other developers. Put the change here instead.

---

## Step 9 — `loadMaintenanceStateFromDb()`

```js
await loadMaintenanceStateFromDb();
```

Maintenance mode state is persisted in the `SystemSetting` table (key: `'maintenance'`, value: JSON). This step reads that record after the database is confirmed ready and loads it into the in-memory cache (`_maintenanceCache`) used by `maintenanceGuard`.

This is necessary because `maintenanceGuard` is mounted as global middleware in step 3 — before the database exists. Without this step, maintenance mode would always read as `false` on server restart even if it was enabled before the server went down.

---

## Step 10 — `server.listen()`

```js
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

The HTTP server starts accepting connections on `PORT` (default `5000`, set via `.env`). Both REST requests and WebSocket connections (Socket.io) are served on the same port.

`server.listen()` is used rather than `app.listen()` because Socket.io is attached to the `http.Server` instance, not to the Express app — `app.listen()` would create a separate server instance that Socket.io is not attached to.

---

## Failure Handling

If any step in `startServer()` throws, the catch block runs:

```js
catch (err) {
    console.error("Failed to start backend:", err.message);
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
        console.error("Check DB_USER and DB_PASSWORD in backend/.env.");
    }
    process.exit(1);
}
```

The process exits with code `1`. Common failure causes:

| Error | Likely cause |
|-------|-------------|
| `Missing required environment variables: JWT_SECRET` | `.env` file missing or variable not set. |
| `Invalid production config: AFRICASTALKING_USERNAME cannot be 'sandbox' in production` | `NODE_ENV=production` but AT username is `"sandbox"`. |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` or `DB_PASSWORD` in `.env`. |
| `ECONNREFUSED` on DB connection | MySQL is not running. |
| `ER_BAD_DB_ERROR` | `ensureDatabaseExists` failed (insufficient MySQL privileges to `CREATE DATABASE`). |

---

## Environment Variables That Affect Boot

| Variable | Default | Effect on boot |
|----------|---------|----------------|
| `NODE_ENV` | — | `"production"` enforces AT sandbox and SKIP_SMS_IN_DEV rules in `validateEnv()`. |
| `DB_HOST` | `localhost` | MySQL host for both `ensureDatabaseExists` and Sequelize. |
| `DB_PORT` | `3306` | MySQL port. |
| `DB_NAME` | — | Database name. Created automatically if missing. |
| `DB_USER` | — | MySQL user. |
| `DB_PASSWORD` | — | MySQL password. |
| `DB_SYNC_ALTER` | `false` | Set `"true"` to run `sequelize.sync({ alter: true })` on this boot. |
| `ENABLE_SCHEMA_COMPAT` | `true` | Set `"false"` to skip `ensureSchemaCompatibility()` entirely (emergency rollback). |
| `JWT_SECRET` | — | Required. Used to sign and verify all JWTs. |
| `AFRICASTALKING_API_KEY` | — | Required. Africa's Talking API key. |
| `AFRICASTALKING_USERNAME` | — | Required. `"sandbox"` routes OTPs to AT simulator; any other value hits the live API. |
| `SKIP_SMS_IN_DEV` | `false` | `"true"` (non-production only) skips SMS and returns OTP in response body. |
| `PORT` | `5000` | Port the HTTP server listens on. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | The only browser origin allowed by CORS and Socket.io. |

---

## Utility Scripts

`backend/src/sync.js` is a standalone script that runs `sequelize.sync({ alter: true })` and exits. It is not part of the normal boot process — it exists as a developer convenience for applying schema changes in isolation without starting the full server.

```bash
node src/sync.js
```

It should not be confused with the `sequelize.sync()` call inside `index.js`. The script uses `{ alter: true }` unconditionally, so treat it the same as setting `DB_SYNC_ALTER=true` on a single boot.

---

## Graceful Shutdown

The server does not currently register `SIGTERM`/`SIGINT` handlers with custom teardown logic. In production (PM2 or a system supervisor), the process receives `SIGTERM` on restart/stop and Node.js exits:

1. In-flight HTTP requests are dropped immediately — there is no drain window.
2. Socket.io connections are terminated.
3. Sequelize's connection pool is garbage-collected (MySQL `wait_timeout` on the server side reclaims idle connections).

**To add graceful shutdown** (recommended for production):

```js
// backend/index.js — after server.listen()
const shutdown = async (signal) => {
  console.log(`[shutdown] Received ${signal}. Closing HTTP server…`);
  server.close(async () => {
    await db.sequelize.close();
    console.log('[shutdown] Database pool closed. Exiting.');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

PM2 sends `SIGINT` by default for `pm2 stop`/`pm2 restart` (`kill_timeout` default: 1600 ms). Setting `kill_timeout: 5000` in `ecosystem.config.js` gives the shutdown handler time to drain.

---

## Connection Pool Tuning

Sequelize uses a connection pool managed by the `sequelize-pool` package. Default limits:

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `pool.max` | `5` | Maximum simultaneous MySQL connections |
| `pool.min` | `0` | Minimum idle connections kept open |
| `pool.acquire` | `30000` ms | Time to wait for a connection before throwing |
| `pool.idle` | `10000` ms | Time before an idle connection is released |

The defaults are conservative and appropriate for development. Under production load (concurrent Socket.io connections + REST API traffic):

- Increase `pool.max` to `10`–`20` depending on MySQL's `max_connections` setting (default 151 for MySQL 8).
- Set `pool.min` to `2`–`5` to keep warm connections ready.

Configure in `backend/src/config/database.js` via the `pool` key in the Sequelize constructor options, or pass env vars:

```js
pool: {
  max: parseInt(process.env.DB_POOL_MAX  || '5',  10),
  min: parseInt(process.env.DB_POOL_MIN  || '0',  10),
  acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000', 10),
  idle:    parseInt(process.env.DB_POOL_IDLE    || '10000', 10),
},
```

Socket.io connections are long-lived but do not hold open MySQL connections between events — they use the pool only during event handler execution, so socket concurrency does not directly translate to pool pressure.
