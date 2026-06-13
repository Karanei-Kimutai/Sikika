import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Admin API service
 * -----------------
 * Centralized axios wrappers for NGO and system admin features.
 * Each request uses the bearer token from localStorage.
 */
function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// NGO workspace aggregate payload (operations KPIs + reports + staffing + resources).
export async function getNgoAdminDashboard() {
  const response = await axios.get(`${API_BASE_URL}/api/admin/ngo/dashboard`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

// System workspace aggregate payload (infra + logs + maintenance + staff directory).
export async function getSystemAdminDashboard() {
  const response = await axios.get(`${API_BASE_URL}/api/admin/system/dashboard`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

// Cross-entity admin lookup used by triage workflows.
export async function runAdminSearch(query) {
  const response = await axios.get(`${API_BASE_URL}/api/admin/search`, {
    headers: getAuthHeaders(),
    params: { q: query }
  });
  return response.data;
}

// Toggle maintenance mode with optional reason and expected return timestamp.
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

// Pulls latest system audit entries; optional incremental fetch by `since`.
export async function getSystemLogs(since) {
  const response = await axios.get(`${API_BASE_URL}/api/admin/system/logs`, {
    headers: getAuthHeaders(),
    params: since ? { since } : undefined
  });
  return response.data;
}

// Runtime actions: CLEAR_CACHE or RESTART_SERVER.
export async function performSystemRuntimeAction(action) {
  const response = await axios.post(
    `${API_BASE_URL}/api/admin/system/runtime-action`,
    { action },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// NGO-admin staff onboarding entrypoint for counsellor/legal counsel accounts.
// Request contract (backend-enforced):
// - phoneNumber: required
// - password: required temporary credential
// - role: COUNSELLOR | LEGAL_COUNSEL
// - specialization, availabilityStatus: optional role metadata
// Response includes created staff summary used for success toasts and refresh.
export async function createNgoStaffAccount(payload) {
  const response = await axios.post(
    `${API_BASE_URL}/api/admin/ngo/staff`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// Suspends or reactivates a counsellor/legal-counsel account.
// This mirrors backend's narrow lifecycle model and intentionally does not
// expose DEACTIVATED state transitions in this client helper.
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

// NGO-admin resource create endpoint.
export async function createNgoResource(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/ngo/resources`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

// NGO-admin resource update endpoint.
export async function updateNgoResource(resourceId, payload) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/resources/${resourceId}`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// NGO-admin manual survivor case reassignment endpoint.
export async function reassignSurvivorCase(payload) {
  const response = await axios.patch(`${API_BASE_URL}/api/admin/ngo/reassignments`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

// Survivor reassignment request lifecycle helpers.
export async function getMyReassignmentRequests() {
  const response = await axios.get(`${API_BASE_URL}/api/reassignment-requests/me`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

export async function createMyReassignmentRequest(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/reassignment-requests/me`, payload, {
    headers: getAuthHeaders()
  });
  return response.data;
}

export async function cancelMyReassignmentRequest(requestId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/reassignment-requests/me/${requestId}/cancel`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// NGO-admin reassignment request triage helpers.
export async function getNgoReassignmentRequests(status = "PENDING") {
  const response = await axios.get(`${API_BASE_URL}/api/reassignment-requests/ngo`, {
    headers: getAuthHeaders(),
    params: { status }
  });
  return response.data;
}

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
 * Update the fulfillment status of a USSD callback request.
 * NGO admin only.
 *
 * @param {string} requestId
 * @param {'COMPLETED'|'CANCELLED'} status
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
