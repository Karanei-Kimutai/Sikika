import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Returns Authorization headers for endpoints that require staff authentication.
 */
function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetch public support resources from the backend.
 *
 * Vite only exposes frontend env variables prefixed with VITE_, so the API
 * base URL is configured through VITE_API_BASE_URL in frontend/.env.
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
 * Creates a support resource.
 *
 * Backend expects multipart form-data so file binary and metadata are sent
 * together in one request.
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
 * Updates an existing support resource.
 *
 * Supports metadata-only updates or metadata + file replacement.
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
 * Deletes a support resource by id.
 */
export async function deleteResource(resourceId) {
  await axios.delete(`${API_BASE_URL}/api/resources/${resourceId}`, {
    headers: getAuthHeaders()
  });
}

/**
 * Sends a best-effort analytics event whenever a user opens a resource.
 * Auth header is optional so anonymous visitors can still be counted.
 */
export async function trackResourceAccess(resourceId) {
  const token = localStorage.getItem("authToken");
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  await axios.post(`${API_BASE_URL}/api/resources/${resourceId}/track-access`, {}, { headers });
}
