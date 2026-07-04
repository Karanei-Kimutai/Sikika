/**
 * apiClient.js
 * ------------
 * Shared axios instance for all authenticated (and public) backend calls.
 *
 * Replaces the pattern, duplicated across ~15 files, of constructing
 * `${API_BASE_URL}${path}` and a manual `Authorization: Bearer <token>` header
 * on every call. Two interceptors centralize that behavior:
 *
 *  - Request: attaches the Bearer token from sessionStorage automatically,
 *    when one is present. Callers that don't have a session yet (sign-in/
 *    sign-up flows) simply get no Authorization header, matching prior
 *    per-file `getAuthHeaders()` behavior.
 *  - Response: on a 401 from any endpoint, the session is no longer valid
 *    (expired token or a mid-session ban) — clear it and send the user back
 *    to /join. Previously there was no global handling for this; each page
 *    just surfaced whatever generic error text came back.
 */

import axios from "axios";
import { getToken, removeToken, removeUserId } from "../utils/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const apiClient = axios.create({ baseURL: API_BASE_URL });

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      removeToken();
      removeUserId();
      if (window.location.pathname !== "/join") {
        window.location.assign("/join");
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
