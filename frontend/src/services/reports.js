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

export async function getEvidenceAccessUrl(reportId, evidenceId) {
  // Backend rotates signed URLs; callers should open the returned URL immediately.
  const response = await axios.get(
    `${API_BASE_URL}/api/reports/${reportId}/evidence/${evidenceId}/access-url`,
    {
      headers: getAuthHeaders()
    }
  );

  return response.data;
}
