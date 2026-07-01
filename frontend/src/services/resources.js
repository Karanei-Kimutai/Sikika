import axios from "axios";
import { getToken } from "../utils/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * resources.js
 * ------------
 * Thin API client for the public support-resource library and the staff/NGO-admin
 * resource management endpoints. Public read endpoints omit the auth header;
 * write endpoints (create, update, delete) require COUNSELLOR, LEGAL_COUNSEL, or
 * NGO_ADMIN credentials.
 *
 * Cloudinary note: resource files are stored as `type: authenticated` private
 * assets and delivered through a backend streaming proxy. This service never
 * constructs or exposes Cloudinary URLs — the file download flow goes through
 * GET /api/resources/:id/file, not a signed URL returned here.
 */

/**
 * Returns the Authorization header for authenticated write requests.
 * Returns an empty object for unauthenticated calls (read endpoints).
 *
 * @returns {{ Authorization: string } | {}}
 */
function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetches the public list of support resources. No auth header is sent —
 * the library is readable by unauthenticated visitors.
 * Results can be filtered server-side by keyword search and category.
 *
 * @param {object} [opts={}]
 * @param {string} [opts.search=""] - Free-text keyword to filter by title/description.
 * @param {string} [opts.category="all"] - Category slug to filter by, or "all" for no filter.
 * @returns {Promise<{ resources: object[], categories: { value: string, label: string }[] }>}
 */
export async function getResources({ search = "", category = "all" } = {}) {
  const response = await axios.get(`${API_BASE_URL}/api/resources`, {
    params: {
      search: search || undefined,
      category: category === "all" ? undefined : category
    }
  });

  return response.data;
}

/**
 * Creates a new support resource. Sends a multipart/form-data request so the
 * file binary and metadata are delivered together in a single request.
 * Requires COUNSELLOR, LEGAL_COUNSEL, or NGO_ADMIN session.
 *
 * @param {object} opts
 * @param {string} opts.title - Display name for the resource.
 * @param {string} [opts.description=""] - Short summary of the resource content.
 * @param {string} opts.category - Category slug (e.g. "legal_guidance", "shelters").
 * @param {File} opts.file - The browser File object to upload.
 * @returns {Promise<{ message: string, resource: object }>}
 */
export async function createResource({ title, description, category, file }) {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("description", description || "");
  formData.append("category", category);
  formData.append("file", file);

  const response = await axios.post(`${API_BASE_URL}/api/resources`, formData, {
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "multipart/form-data"
    }
  });

  return response.data;
}

/**
 * Updates an existing support resource. Supports metadata-only updates (no `file`)
 * or a combined metadata + file replacement. Only fields that are explicitly provided
 * are sent; undefined values are omitted from the FormData payload.
 * Requires COUNSELLOR, LEGAL_COUNSEL, or NGO_ADMIN session.
 *
 * @param {string} resourceId - SupportResource.resourceId UUID.
 * @param {object} opts
 * @param {string} [opts.title] - New display name.
 * @param {string} [opts.description] - New summary text.
 * @param {string} [opts.category] - New category slug.
 * @param {File} [opts.file] - Replacement file; omit to keep the existing file.
 * @returns {Promise<{ message: string, resource: object }>}
 */
export async function updateResource(resourceId, { title, description, category, file }) {
  const formData = new FormData();

  if (title !== undefined) formData.append("title", title);
  if (description !== undefined) formData.append("description", description);
  if (category !== undefined) formData.append("category", category);
  if (file) formData.append("file", file);

  const response = await axios.patch(`${API_BASE_URL}/api/resources/${resourceId}`, formData, {
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "multipart/form-data"
    }
  });

  return response.data;
}

/**
 * Deletes a support resource and its associated Cloudinary asset.
 * Requires COUNSELLOR, LEGAL_COUNSEL, or NGO_ADMIN session.
 *
 * @param {string} resourceId - SupportResource.resourceId UUID.
 * @returns {Promise<void>}
 */
export async function deleteResource(resourceId) {
  await axios.delete(`${API_BASE_URL}/api/resources/${resourceId}`, {
    headers: getAuthHeaders()
  });
}

/**
 * Sends a best-effort analytics event whenever a user opens a resource.
 * The auth header is optional so anonymous visitors can still be counted;
 * the backend records a NULL `accessorUserId` for unauthenticated events.
 * Callers fire and ignore the response — failures must never block the UI.
 *
 * @param {string} resourceId - SupportResource.resourceId UUID.
 * @returns {Promise<void>}
 */
export async function trackResourceAccess(resourceId) {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  await axios.post(`${API_BASE_URL}/api/resources/${resourceId}/track-access`, {}, { headers });
}
