import axios from "axios";
import { getToken } from "../utils/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * admin.js
 * --------
 * Centralized axios wrappers for NGO admin features (the only admin role —
 * System Admin and its infrastructure dashboard have been removed).
 * Each request attaches the Bearer token from sessionStorage via getToken().
 * All functions return raw response.data to keep page-level composition flexible.
 */

/**
 * Returns the Authorization header for authenticated requests, or an empty
 * object when no token is present.
 *
 * @returns {{ Authorization: string } | {}}
 */
function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetches the NGO admin dashboard aggregate payload:
 * operations KPIs, report summaries, staffing metrics, and resource counts.
 * Used by the Command Center section of NgoAdminDashboardPage.
 *
 * @returns {Promise<object>} Dashboard aggregate data from the backend.
 */
export async function getNgoAdminDashboard() {
  const response = await axios.get(`${API_BASE_URL}/api/admin/ngo/dashboard`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Cross-entity admin search used by triage and team-capacity workflows.
 * Returns survivors, staff, and reports matching the query string.
 *
 * @param {string} query - Free-text search term.
 * @returns {Promise<{ results: object[] }>}
 */
export async function runAdminSearch(query) {
  const response = await axios.get(`${API_BASE_URL}/api/admin/search`, {
    headers: getAuthHeaders(),
    params: { q: query }
  });
  return response.data;
}

/**
 * Toggles maintenance mode on or off. When enabled, all non-NGO-admin sessions
 * receive the maintenance screen and the backend returns 503 for API requests.
 * This capability was formerly owned by System Admin; it is now folded into the
 * NGO Admin dashboard.
 *
 * @param {boolean} enabled - true to enable maintenance, false to disable.
 * @param {object} [options={}]
 * @param {string} [options.reason] - Human-readable description shown on the maintenance screen.
 * @param {string} [options.expectedUntil] - ISO 8601 timestamp for the estimated return time.
 * @returns {Promise<{ message: string, maintenance: object }>}
 */
export async function setMaintenanceMode(enabled, options = {}) {
  const payload = {
    enabled,
    reason: options.reason,
    expectedUntil: options.expectedUntil
  };

  const response = await axios.post(
    `${API_BASE_URL}/api/admin/system/maintenance-mode`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Creates a new staff account (onboarding entrypoint for COUNSELLOR, LEGAL_COUNSEL,
 * and MODERATOR roles). The account is provisioned with a temporary password that
 * triggers a forced-reset flow on first login.
 *
 * Required payload fields (backend-validated):
 *   phoneNumber — unique phone number for the new staff member
 *   password    — temporary credential; must meet complexity requirements
 *   role        — "COUNSELLOR" | "LEGAL_COUNSEL" | "MODERATOR"
 * Optional:
 *   specialization     — practice area (ignored for MODERATOR)
 *   availabilityStatus — initial status (defaults to AVAILABLE; ignored for MODERATOR)
 *
 * @param {object} payload - Staff account creation fields.
 * @returns {Promise<{ message: string, staff: object }>}
 */
export async function createNgoStaffAccount(payload) {
  const response = await axios.post(
    `${API_BASE_URL}/api/admin/ngo/staff`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Suspends or reactivates a counsellor or legal-counsel account.
 * Suspended accounts cannot be auto-assigned new survivors. The "SUSPENDED"
 * state is distinct from "BANNED" — suspension is a reversible operational
 * toggle; ban is a moderation/safety action with audit metadata.
 *
 * @param {string} userId - UserAccount.userId of the staff member.
 * @param {"ACTIVE"|"SUSPENDED"} status - Target account status.
 * @returns {Promise<{ message: string, user: object }>}
 */
export async function updateNgoStaffStatus(userId, status) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/staff/${userId}/status`,
    { status },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * banUser
 * -------
 * Applies a BANNED lifecycle state to the target user via the NGO admin ban endpoint.
 *
 * @param {string} userId - UUID of the account to ban.
 * @param {{ reason: string, expiresAt?: string|null }} payload
 *   reason is required; expiresAt is an ISO date string for temporary bans or
 *   null/omitted for a permanent ban.
 * @returns {Promise<object>} Updated user account status data from the backend.
 */
export async function banUser(userId, { reason, expiresAt = null } = {}) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/users/${userId}/ban`,
    { reason, expiresAt },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * unbanUser
 * ---------
 * Lifts the BANNED lifecycle state and restores the account to ACTIVE.
 *
 * @param {string} userId - UUID of the account to unban.
 * @returns {Promise<object>} Updated user account status data from the backend.
 */
export async function unbanUser(userId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/users/${userId}/unban`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * reviewModerationReport
 * -----------------------
 * Submits a moderation decision for a harmful-content report.
 *
 * @param {string} reportId - UUID of the HarmfulContentReport to review.
 * @param {string} reviewStatus - "APPROVED" or "REJECTED".
 * @param {string} [action="none"] - Side-effect action: "remove_message", "issue_warning",
 *   "ban_user", or "none".
 * @param {{ reason?: string, expiresAt?: string|null }} [options={}] - Extra body fields
 *   for "ban_user": reason (defaults to the report's own text on the backend) and optional
 *   expiresAt ISO date string for a temporary ban. Ignored by other actions.
 * @returns {Promise<object>}
 */
export async function reviewModerationReport(reportId, reviewStatus, action = "none", options = {}) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/community/moderation/reports/${reportId}`,
    { reviewStatus, action, ...options },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Creates a support resource via the NGO-admin resource management endpoint.
 * Payload is expected to be a FormData object (multipart) containing file + metadata.
 *
 * @param {FormData} payload - Multipart payload with title, description, category, file.
 * @returns {Promise<{ message: string, resource: object }>}
 */
export async function createNgoResource(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/ngo/resources`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Updates an existing support resource via the NGO-admin endpoint.
 * Payload can include metadata changes only, or a file replacement.
 *
 * @param {string} resourceId - SupportResource.resourceId UUID.
 * @param {FormData|object} payload - Updated fields (partial update supported).
 * @returns {Promise<{ message: string, resource: object }>}
 */
export async function updateNgoResource(resourceId, payload) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/resources/${resourceId}`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Applies a manual survivor case reassignment chosen by the NGO admin.
 * The payload must specify survivorId, counsellorId, and/or legalCounselId.
 *
 * @param {{ survivorId: string, counsellorId?: string, legalCounselId?: string }} payload
 * @returns {Promise<{ message: string, survivor: object }>}
 */
export async function reassignSurvivorCase(payload) {
  const response = await axios.patch(`${API_BASE_URL}/api/admin/ngo/reassignments`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Returns the recommended (least-loaded, ACTIVE) counsellor and legal counsel
 * for a survivor, shown as a "Recommended" badge in the Team Capacity reassignment
 * form. The admin can apply or ignore the suggestions.
 *
 * @param {string} survivorId - SurvivorProfile.survivorId UUID.
 * @returns {Promise<{ suggestedCounsellor: object|null, suggestedLegalCounsel: object|null }>}
 */
export async function getReassignmentSuggestions(survivorId) {
  const response = await axios.get(`${API_BASE_URL}/api/admin/ngo/reassignments/suggestions`, {
    headers: getAuthHeaders(),
    params: { survivorId }
  });
  return response.data;
}

/**
 * Fetches the authenticated survivor's own reassignment request history, newest first.
 *
 * @returns {Promise<{ requests: object[] }>}
 */
export async function getMyReassignmentRequests() {
  const response = await axios.get(`${API_BASE_URL}/api/reassignment-requests/me`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Submits a new staff reassignment request on behalf of the authenticated survivor.
 *
 * @param {{ requestedScope: "COUNSELLOR"|"LEGAL_COUNSEL"|"BOTH", requestReasonText: string }} payload
 * @returns {Promise<{ message: string, request: object }>}
 */
export async function createMyReassignmentRequest(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/reassignment-requests/me`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Cancels a pending reassignment request by its ID. Only the owning survivor can cancel.
 *
 * @param {string} requestId - StaffReassignmentRequest.requestId UUID.
 * @returns {Promise<{ message: string, request: object }>}
 */
export async function cancelMyReassignmentRequest(requestId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/reassignment-requests/me/${requestId}/cancel`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Fetches the reassignment request queue for NGO admin review.
 * Defaults to PENDING requests; pass "ALL" to see the full history.
 *
 * @param {"PENDING"|"APPROVED"|"REJECTED"|"CANCELLED"|"ALL"} [status="PENDING"]
 * @returns {Promise<{ requests: object[] }>}
 */
export async function getNgoReassignmentRequests(status = "PENDING") {
  const response = await axios.get(`${API_BASE_URL}/api/reassignment-requests/ngo`, {
    headers: getAuthHeaders(),
    params: { status }
  });
  return response.data;
}

/**
 * Submits the NGO admin's decision (APPROVED or REJECTED) on a survivor reassignment request.
 * An APPROVED decision triggers actual staff reassignment via the backend.
 *
 * @param {string} requestId - StaffReassignmentRequest.requestId UUID.
 * @param {{ requestStatus: "APPROVED"|"REJECTED", ngoAdminReviewNote?: string }} payload
 * @returns {Promise<{ message: string, request: object }>}
 */
export async function reviewNgoReassignmentRequest(requestId, payload) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/reassignment-requests/ngo/${requestId}/review`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * Fetch all USSD callback requests, newest first.
 * NGO admin only.
 *
 * @returns {Promise<{requests: Array}>}
 */
export async function getUssdCallbackRequests() {
  const response = await axios.get(`${API_BASE_URL}/api/ussd/callback-requests`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Fetch the USSD callback requests auto-assigned to the calling counsellor,
 * newest first. Counsellor only.
 *
 * @returns {Promise<{requests: Array}>}
 */
export async function getMyCallbackRequests() {
  const response = await axios.get(`${API_BASE_URL}/api/ussd/my-callback-requests`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * Update the fulfillment status of a USSD callback request.
 * NGO admin can update any request; a counsellor can only update one
 * auto-assigned to them (enforced server-side).
 *
 * @param {string} requestId - UssdCallbackRequest.requestId UUID.
 * @param {'COMPLETED'|'CANCELLED'} status - New fulfillment status.
 * @returns {Promise<{message: string, request: object}>}
 */
export async function updateUssdCallbackRequest(requestId, status) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/ussd/callback-requests/${requestId}`,
    { callbackFulfillmentStatus: status },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * listBannedUsers
 * ---------------
 * Returns all accounts currently in BANNED status.
 * NGO admin only. Optional `role` filter: 'SURVIVOR' | 'COUNSELLOR' | 'LEGAL_COUNSEL'.
 *
 * @param {string} [role] - Optional role to filter by.
 * @returns {Promise<{bannedUsers: Array, total: number}>}
 */
export async function listBannedUsers(role) {
  const params = role ? { role } : undefined;
  const response = await axios.get(`${API_BASE_URL}/api/admin/ngo/banned-users`, {
    headers: getAuthHeaders(),
    params
  });
  return response.data;
}

// Governance note:
// System-admin staff lifecycle helpers were intentionally removed from this file.
// Staffing ownership now lives under NGO admin routes and UI flows.
