import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

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
 * Sends a best-effort analytics event whenever a user opens a resource.
 * Auth header is optional so anonymous visitors can still be counted.
 */
export async function trackResourceAccess(resourceId) {
  const token = localStorage.getItem("authToken");
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  await axios.post(`${API_BASE_URL}/api/resources/${resourceId}/track-access`, {}, { headers });
}
