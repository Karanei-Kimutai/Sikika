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
export async function createNgoStaffAccount(payload) {
  const response = await axios.post(
    `${API_BASE_URL}/api/admin/ngo/staff`,
    payload,
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// Suspends or reactivates a counsellor/legal-counsel account.
export async function updateNgoStaffStatus(userId, status) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/admin/ngo/staff/${userId}/status`,
    { status },
    { headers: getAuthHeaders() }
  );
  return response.data;
}

// Community moderation decision endpoint.
export async function reviewModerationReport(reportId, reviewStatus, action = "none") {
  const response = await axios.patch(
    `${API_BASE_URL}/api/community/moderation/reports/${reportId}`,
    { reviewStatus, action },
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
