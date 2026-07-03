/**
 * reportStatusRules.js
 * ---------------------
 * Client-side mirror of the report status state machine enforced in
 * backend/src/controllers/reportController.js (STATUS_TRANSITIONS +
 * STATUS_UPDATE_PERMISSIONS, documented in docs/reporting.md). The backend
 * remains the source of truth and re-validates every transition — this copy
 * exists purely so the status-update dropdown never offers an option that
 * would be rejected. Keep both maps in sync if the backend workflow changes.
 */

/** Which target statuses are reachable from each current status. */
const STATUS_TRANSITIONS = {
  SUBMITTED: ["UNDER_REVIEW", "WITHDRAWN"],
  UNDER_REVIEW: ["ACTIVE_SUPPORT", "UNDER_INVESTIGATION", "WITHDRAWN"],
  ACTIVE_SUPPORT: ["UNDER_INVESTIGATION", "LEGAL_REVIEW", "RESOLVED", "WITHDRAWN"],
  UNDER_INVESTIGATION: ["LEGAL_REVIEW", "RESOLVED", "WITHDRAWN"],
  LEGAL_REVIEW: ["ESCALATED_TO_LEGAL_CASE", "ACTIVE_SUPPORT", "RESOLVED", "WITHDRAWN"],
  ESCALATED_TO_LEGAL_CASE: ["RESOLVED"],
  RESOLVED: [],
  WITHDRAWN: []
};

/**
 * Which target statuses each role is ever allowed to set, regardless of what
 * STATUS_TRANSITIONS would otherwise permit. SURVIVOR is intentionally
 * omitted — survivors withdraw via a separate dedicated endpoint, not this
 * generic status-update path.
 */
const STATUS_UPDATE_PERMISSIONS = {
  COUNSELLOR: ["ACTIVE_SUPPORT", "UNDER_INVESTIGATION", "RESOLVED"],
  LEGAL_COUNSEL: ["LEGAL_REVIEW", "ESCALATED_TO_LEGAL_CASE", "RESOLVED"],
  NGO_ADMIN: ["UNDER_REVIEW", "ACTIVE_SUPPORT", "UNDER_INVESTIGATION", "LEGAL_REVIEW", "RESOLVED"]
};

/**
 * Returns the statuses a given role may legally move a report to from its
 * current status right now — the intersection of "reachable at all" and
 * "this role is permitted to set it".
 *
 * @param {string} currentStatus - Report's current currentReportStatus value.
 * @param {string} role - Caller's normalized role (e.g. "LEGAL_COUNSEL").
 * @returns {string[]} Allowed next statuses, possibly empty.
 */
export function getAllowedNextStatuses(currentStatus, role) {
  const reachable = STATUS_TRANSITIONS[currentStatus] || [];
  const permitted = STATUS_UPDATE_PERMISSIONS[role] || [];
  return reachable.filter((status) => permitted.includes(status));
}
