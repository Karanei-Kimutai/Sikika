import axios from "axios";
import { getToken } from "../utils/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * reports.js
 *
 * Thin API client for /api/reports endpoints.
 * - Authorization is always derived from sessionStorage authToken via getToken().
 * - Functions return raw response.data to keep page-level composition flexible.
 * - Upload/download flows use multipart + short-lived signed URLs.
 */

/**
 * Returns the Authorization header for authenticated requests, or an empty
 * object when the session has no token (caller is responsible for redirecting).
 *
 * @returns {{ Authorization: string } | {}}
 */
function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetches all incident reports visible to the authenticated user.
 * Survivors see only their own reports; counsellors, legal counsel, and
 * NGO admins see reports assigned or relevant to their role.
 *
 * @returns {Promise<{ reports: object[] }>}
 */
export async function getReports() {
  const response = await axios.get(`${API_BASE_URL}/api/reports`, {
    headers: getAuthHeaders()
  });

  return response.data;
}

/**
 * Fetches a single incident report by its UUID.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @returns {Promise<{ report: object }>}
 */
export async function getReportById(reportId) {
  const response = await axios.get(`${API_BASE_URL}/api/reports/${reportId}`, {
    headers: getAuthHeaders()
  });

  return response.data;
}

/**
 * Creates a new incident report. The payload shape is validated by the backend
 * (incidentType, incidentDate, description are required for survivors).
 *
 * @param {object} payload - Report fields (incidentType, description, incidentDate, etc.).
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function createReport(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/reports`, payload, {
    headers: getAuthHeaders()
  });

  return response.data;
}

/**
 * Updates editable fields on a survivor's own report (e.g. description, location).
 * Only available while the report is in SUBMITTED status.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @param {object} payload - Partial report fields to update.
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function updateOwnReport(reportId, payload) {
  const response = await axios.patch(`${API_BASE_URL}/api/reports/${reportId}`, payload, {
    headers: getAuthHeaders()
  });

  return response.data;
}

/**
 * Advances the report to a new status. Role-scoped transition rules are enforced
 * by the backend — see the 7-state machine in reportController.js.
 * The `survivorConsent` flag is required by the backend when escalating to
 * LEGAL_REVIEW or ESCALATED_TO_LEGAL_CASE to confirm the survivor agreed.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @param {string} reportStatus - Target status (e.g. "UNDER_REVIEW", "LEGAL_REVIEW").
 * @param {boolean} [survivorConsent=false] - Must be true when escalating to legal stages.
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function updateReportStatus(reportId, reportStatus, survivorConsent = false) {
  // survivorConsent is required by backend when escalating to legal case.
  const response = await axios.patch(
    `${API_BASE_URL}/api/reports/${reportId}/status`,
    { reportStatus, survivorConsent },
    { headers: getAuthHeaders() }
  );

  return response.data;
}

/**
 * Transitions the report to WITHDRAWN status. Requires the survivor's own
 * session — backend enforces survivor-only access for withdrawals.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function withdrawReport(reportId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/reports/${reportId}/withdraw`,
    { confirmWithdraw: true },
    { headers: getAuthHeaders() }
  );

  return response.data;
}

/**
 * Uploads an evidence file (image, video, audio, or document) attached to a report.
 * Sends as multipart/form-data with the file under the field name "file" (multer
 * expectation on the backend). Files are stored privately on Cloudinary; use
 * `getEvidenceAccessUrl` to retrieve a time-limited streaming URL.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @param {File} file - The browser File object selected by the user.
 * @returns {Promise<{ message: string, evidence: object }>}
 */
export async function uploadEvidence(reportId, file) {
  // Multer expects the file field name to be exactly "file".
  const formData = new FormData();
  formData.append("file", file);

  const response = await axios.post(
    `${API_BASE_URL}/api/reports/${reportId}/evidence`,
    formData,
    {
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "multipart/form-data"
      }
    }
  );

  return response.data;
}

/**
 * Permanently deletes a survivor's own report. Only available in SUBMITTED status.
 * Requires `confirmWithdraw: true` in the request body as a safety guard.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @returns {Promise<{ message: string }>}
 */
export async function deleteOwnReport(reportId) {
  const response = await axios.delete(`${API_BASE_URL}/api/reports/${reportId}`, {
    headers: getAuthHeaders(),
    data: { confirmWithdraw: true }
  });

  return response.data;
}

/**
 * getEvidenceAccessUrl
 * --------------------
 * Streams the evidence file through the backend proxy and returns a local
 * object URL that callers can pass to window.open.
 *
 * Evidence files are stored as private Cloudinary assets. The backend fetches
 * them with API credentials and streams the bytes; this function downloads
 * them as a Blob (with the Bearer auth header), creates an object URL, and
 * schedules revocation after 60 seconds so the opened tab has time to load.
 *
 * Returns the same { signedUrl } shape as before so all call sites are
 * unchanged.
 *
 * @param {string} reportId - IncidentReport.reportId UUID.
 * @param {string} evidenceId - EvidenceFile.evidenceId UUID.
 * @returns {Promise<{ signedUrl: string }>}
 */
export async function getEvidenceAccessUrl(reportId, evidenceId) {
  const response = await axios.get(
    `${API_BASE_URL}/api/reports/${reportId}/evidence/${evidenceId}/file`,
    {
      headers: getAuthHeaders(),
      responseType: "blob"
    }
  );

  const objectUrl = URL.createObjectURL(response.data);

  // Revoke the object URL after the tab has had time to load the file.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return { signedUrl: objectUrl };
}
