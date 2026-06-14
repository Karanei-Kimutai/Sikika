/**
 * roles.js
 * --------
 * Shared role constants and normalisation helpers used across controllers.
 *
 * Centralises the role enum and bannable-role policy so the two ban paths
 * (admin endpoint and community moderation) enforce identical rules from one
 * source of truth.
 */

/**
 * Roles that can be banned by an NGO admin.
 *
 * Admin accounts (NGO_ADMIN, SYSTEM_ADMIN) are intentionally excluded:
 * removing an admin requires a full deactivation workflow, not a ban.
 *
 * @type {string[]}
 */
const BANNABLE_ROLES = ['SURVIVOR', 'COUNSELLOR', 'LEGAL_COUNSEL'];

/**
 * normalizeRole
 * -------------
 * Converts loose role strings from JWT payloads, DB values, or request bodies
 * into a stable uppercase canonical form.
 *
 * Handles camelCase variants emitted by older token issuers:
 *   - "legalCounsel"  → "LEGAL_COUNSEL"
 *   - "ngoAdmin"      → "NGO_ADMIN"
 *   - "systemAdmin"   → "SYSTEM_ADMIN"
 *
 * @param {*} value - Raw role value (string, number, or falsy).
 * @returns {string} Canonical uppercase role string.
 */
function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'LEGALCOUNSEL') return 'LEGAL_COUNSEL';
  if (role === 'NGOADMIN') return 'NGO_ADMIN';
  if (role === 'SYSTEMADMIN') return 'SYSTEM_ADMIN';
  return role;
}

module.exports = { normalizeRole, BANNABLE_ROLES };
