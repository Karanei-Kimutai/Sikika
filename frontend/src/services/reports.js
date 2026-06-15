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

function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getReports() {
  const response = await axios.get(`${API_BASE_URL}/api/reports`, {
    headers: getAuthHeaders()
  });

  return response.data;
}

export async function getReportById(reportId) {
  const response = await axios.get(`${API_BASE_URL}/api/reports/${reportId}`, {
    headers: getAuthHeaders()
  });

  return response.data;
}

export async function createReport(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/reports`, payload, {
    headers: getAuthHeaders()
  });

  return response.data;
}

export async function updateOwnReport(reportId, payload) {
  const response = await axios.patch(`${API_BASE_URL}/api/reports/${reportId}`, payload, {
    headers: getAuthHeaders()
  });

  return response.data;
}

export async function updateReportStatus(reportId, reportStatus, survivorConsent = false) {
  // survivorConsent is required by backend when escalating to legal case.
  const response = await axios.patch(
    `${API_BASE_URL}/api/reports/${reportId}/status`,
    { reportStatus, survivorConsent },
    { headers: getAuthHeaders() }
  );

  return response.data;
}

export async function withdrawReport(reportId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/reports/${reportId}/withdraw`,
    { confirmWithdraw: true },
    { headers: getAuthHeaders() }
  );

  return response.data;
}

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
 * @param {string} reportId
 * @param {string} evidenceId
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
