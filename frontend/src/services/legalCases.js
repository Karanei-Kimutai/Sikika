/**
 * legalCases.js — Frontend service for legal case drafting and export.
 *
 * All functions are thin wrappers over the REST endpoints exposed by
 * legalCaseController.js. They read the auth token from sessionStorage
 * via getToken() and attach it as a Bearer header.
 *
 * Endpoints consumed:
 *   PATCH  /api/legal-cases/:legalCaseId               — saveLegalCaseDraft
 *   PATCH  /api/legal-cases/:legalCaseId/status        — updateLegalCaseStatus
 *   POST   /api/legal-cases/:legalCaseId/document      — generateLegalCaseDocument
 *   GET    /api/legal-cases/:legalCaseId/document      — getLegalCaseDocumentUrl (blob stream)
 */

import axios from 'axios';
import { getToken } from '../utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Returns headers with the Bearer token from sessionStorage.
 *
 * @returns {{ Authorization: string }}
 */
function authHeaders() {
  const token = getToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * saveLegalCaseDraft
 * ------------------
 * Persists one or more of the four authoring fields for a legal case.
 * Any combination of the four may be supplied; omitted fields are unchanged.
 *
 * @param {string} legalCaseId
 * @param {{ caseSummary?: string, legalGroundsText?: string, requestedReliefText?: string, recommendedActionsText?: string }} fields
 * @returns {Promise<object>} Updated draft fields and draftLastUpdatedAt.
 */
export async function saveLegalCaseDraft(legalCaseId, fields) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/legal-cases/${legalCaseId}`,
    fields,
    { headers: authHeaders() }
  );
  return response.data;
}

/**
 * updateLegalCaseStatus
 * ---------------------
 * Advances the case lifecycle to the next status.
 *
 * Valid transitions enforced by the backend:
 * OPEN → UNDER_INVESTIGATION → READY_FOR_SUBMISSION → SUBMITTED → CLOSED
 *
 * @param {string} legalCaseId
 * @param {string} status - Target case status.
 * @returns {Promise<object>} Updated case with new currentCaseStatus.
 */
export async function updateLegalCaseStatus(legalCaseId, status) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/legal-cases/${legalCaseId}/status`,
    { status },
    { headers: authHeaders() }
  );
  return response.data;
}

/**
 * generateLegalCaseDocument
 * -------------------------
 * Triggers server-side PDF generation from the current draft fields.
 * The PDF is uploaded privately to Cloudinary and the Cloudinary public_id
 * is stored on the case record. Use getLegalCaseDocumentUrl to retrieve a
 * short-lived signed URL to open the PDF.
 *
 * @param {string} legalCaseId
 * @returns {Promise<{ message: string, documentGeneratedAt: string, legalCaseId: string }>}
 */
export async function generateLegalCaseDocument(legalCaseId) {
  const response = await axios.post(
    `${API_BASE_URL}/api/legal-cases/${legalCaseId}/document`,
    {},
    { headers: authHeaders() }
  );
  return response.data;
}

/**
 * getLegalCaseDocumentUrl
 * -----------------------
 * Streams the generated legal-case PDF through the backend proxy and returns
 * a local object URL that callers can pass to window.open.
 *
 * The PDF is stored as a private Cloudinary asset. The backend fetches it with
 * API credentials and streams the bytes; this function downloads them as a
 * Blob (with the Bearer auth header), creates an object URL, and schedules
 * revocation after 60 seconds so the opened tab has time to load.
 *
 * Returns the same { signedUrl } shape as before so all call sites are
 * unchanged.
 *
 * @param {string} legalCaseId
 * @returns {Promise<{ signedUrl: string }>}
 */
export async function getLegalCaseDocumentUrl(legalCaseId) {
  const response = await axios.get(
    `${API_BASE_URL}/api/legal-cases/${legalCaseId}/document`,
    { headers: authHeaders(), responseType: "blob" }
  );

  const objectUrl = URL.createObjectURL(response.data);

  // Revoke the object URL after the tab has had time to load the PDF.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return { signedUrl: objectUrl };
}
