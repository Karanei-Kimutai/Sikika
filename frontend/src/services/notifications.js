import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * notifications.js
 *
 * Thin API client for /api/notifications endpoints.
 *
 * All functions scope their requests to the authenticated user via the
 * Authorization header — the backend enforces per-user ownership of every
 * read and write operation.
 *
 * Discreet wording policy (SSD §22.2): notification message text is composed
 * and enforced by the backend. This service layer transmits the stored text
 * without modification and never exposes GBV or platform-purpose context.
 */

/**
 * Returns the Authorization header object for authenticated requests.
 * Returns an empty object when no token is present (caller should redirect to /join).
 *
 * @returns {{ Authorization: string } | {}}
 */
function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * getNotifications
 * ----------------
 * Fetches the authenticated user's visible (non-dismissed) notifications,
 * newest first. Also returns the current unreadCount in the same response.
 *
 * @param {boolean} [unreadOnly=false] - When true, only UNREAD notifications are returned.
 * @returns {Promise<{ notifications: object[], unreadCount: number, total: number }>}
 */
export async function getNotifications(unreadOnly = false) {
  const response = await axios.get(`${API_BASE_URL}/api/notifications`, {
    headers: getAuthHeaders(),
    params: unreadOnly ? { unreadOnly: "true" } : {}
  });
  return response.data;
}

/**
 * getUnreadCount
 * --------------
 * Lightweight endpoint for header bell badge polling.
 * Avoids fetching full notification payloads — only returns the integer count.
 *
 * @returns {Promise<{ unreadCount: number }>}
 */
export async function getUnreadCount() {
  const response = await axios.get(`${API_BASE_URL}/api/notifications/unread-count`, {
    headers: getAuthHeaders()
  });
  return response.data;
}

/**
 * markNotificationRead
 * --------------------
 * Marks a single notification as READ. Idempotent — safe to call repeatedly.
 *
 * @param {string} notificationId - The UUID of the notification to mark.
 * @returns {Promise<{ message: string, notificationId: string }>}
 */
export async function markNotificationRead(notificationId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/notifications/${notificationId}/read`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * markAllNotificationsRead
 * ------------------------
 * Bulk marks all of the user's unread visible notifications as READ.
 * Used by the "Mark all as read" action in the notification panel header.
 *
 * @returns {Promise<{ message: string, updated: number }>}
 */
export async function markAllNotificationsRead() {
  const response = await axios.patch(
    `${API_BASE_URL}/api/notifications/read-all`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}

/**
 * dismissNotification
 * -------------------
 * Sets a notification's dismissed state to DISMISSED, hiding it from the
 * default panel list. The notification is retained in the database for audit.
 *
 * Dismiss is intentionally separate from read — a user can dismiss without
 * reading (quick clear) or read without dismissing (wants to revisit later).
 *
 * @param {string} notificationId - The UUID of the notification to dismiss.
 * @returns {Promise<{ message: string, notificationId: string }>}
 */
export async function dismissNotification(notificationId) {
  const response = await axios.patch(
    `${API_BASE_URL}/api/notifications/${notificationId}/dismiss`,
    {},
    { headers: getAuthHeaders() }
  );
  return response.data;
}
