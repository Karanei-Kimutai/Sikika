import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, X } from "lucide-react";
import { getToken } from "../utils/auth";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification
} from "../services/notifications";
import notificationSocket from "../services/notificationSocket";

/**
 * formatNotificationTime
 * ----------------------
 * Formats a notification timestamp for display in the panel.
 * Uses toLocaleString for a locale-appropriate absolute date/time — consistent
 * with how NgoAdminDashboardPage and other components format timestamps.
 * Defined outside the component (pure given the same input) so it is stable
 * across renders and does not trigger the react-hooks/purity lint rule.
 *
 * @param {string} timestamp - ISO date string from the notification row.
 * @returns {string}
 */
function formatNotificationTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString();
}

/**
 * getCategoryLabel
 * ----------------
 * Returns a short, discreet category tag for display in the panel row.
 * Labels are intentionally generic to comply with SSD §22.2 wording policy.
 * Defined outside the component — pure function with no dependency on component state.
 *
 * @param {string} category - notificationCategoryType value.
 * @returns {string}
 */
function getCategoryLabel(category) {
  const labels = {
    NEW_MESSAGE: "Message",
    REPORT_UPDATE: "Update",
    ASSIGNMENT: "Assignment",
    MODERATION_ALERT: "Notice",
    NEW_SUBMISSION: "Submission",
    CALLBACK_REQUEST: "Callback"
  };
  return labels[category] || "Update";
}

/**
 * decodeRoleFromToken
 * -------------------
 * Reads the role claim out of the stored JWT without a network call.
 * Mirrors the same inline pattern used in App.jsx/ReportingPage.jsx — this
 * project has no shared auth-decoding util, so each consumer decodes locally.
 *
 * @returns {string} Uppercased role string, or "" when unauthenticated.
 */
function decodeRoleFromToken() {
  const token = getToken();
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.role || "").toUpperCase();
  } catch {
    return "";
  }
}

/**
 * resolveNotificationPath
 * ------------------------
 * Maps a notification's category + related entity to the in-app route that
 * shows the thing it's about, so clicking a row can navigate there directly.
 * Falls back to the bare page when relatedEntityId is missing (e.g. rows
 * created before this field existed) — still useful, just not item-specific.
 * Returns null for categories with nothing to navigate to (e.g. ASSIGNMENT,
 * which has no active notification-creation path in the backend today).
 *
 * @param {object} notification - Row with notificationCategoryType + relatedEntityId.
 * @returns {string|null}
 */
function resolveNotificationPath(notification) {
  const category = notification.notificationCategoryType;
  const entityId = notification.relatedEntityId;

  switch (category) {
    case "NEW_MESSAGE":
      return entityId ? `/chat?channel=${entityId}` : "/chat";
    case "REPORT_UPDATE":
    case "NEW_SUBMISSION":
      return entityId ? `/reports?reportId=${entityId}` : "/reports";
    case "MODERATION_ALERT":
      return entityId ? `/community?room=${entityId}` : "/community";
    case "CALLBACK_REQUEST":
      // NGO Admin's USSD callback queue lives at a different route than the
      // counsellor's "My Callbacks" page — the role-based route maps in
      // App.jsx resolve each to the correct dashboard section.
      return decodeRoleFromToken() === "NGO_ADMIN" ? "/ussd-callbacks" : "/callbacks";
    default:
      return null;
  }
}

/**
 * NotificationBell
 * ----------------
 * Header bell button with unread badge and a dropdown notification panel.
 *
 * Behavior overview:
 * - Polls getUnreadCount() every 30 seconds while mounted so the badge stays
 *   current without a full page reload. Mirrors the public-status poll pattern
 *   in App.jsx (clearInterval on unmount to prevent memory leaks).
 * - On bell click: opens the panel and fetches the full notification list.
 * - Row click: marks the notification as READ and decrements the badge.
 * - Dismiss (✕) button: hides the notification from the panel (DISMISSED state).
 * - "Mark all as read" button: bulk-reads all visible unread notifications.
 * - Panel closes when the user clicks outside (document click listener).
 *
 * Discreet wording policy (SSD §22.2):
 *   All message text comes from the backend and follows neutral wording.
 *   This component does not compose notification messages and must not add
 *   GBV-identifying context to any label or aria description.
 *
 * Props:
 * @prop {boolean} isAuthenticated - If false, the bell is not rendered.
 * @prop {Function} onNavigate - App.jsx's pushState navigator; used to jump to
 *   the chat/report/room/etc. a notification refers to when its row is clicked.
 */
function NotificationBell({ isAuthenticated, onNavigate }) {
  /** Integer unread count driving the badge display. */
  const [unreadCount, setUnreadCount] = useState(0);

  /** Full notification list, loaded lazily when the panel opens. */
  const [notifications, setNotifications] = useState([]);

  /** Whether the dropdown panel is currently open. */
  const [panelOpen, setPanelOpen] = useState(false);

  /** Loading state for the full notification list fetch. */
  const [loading, setLoading] = useState(false);

  /** Error message to show inside the panel if list fetch fails. */
  const [error, setError] = useState(null);

  /**
   * Ref wrapping the entire bell+panel element so outside-click detection
   * can check whether a click occurred inside or outside the component.
   */
  const containerRef = useRef(null);

  // ── Unread count polling ─────────────────────────────────────────────────
  useEffect(() => {
    // Disconnect on sign-out (isAuthenticated flips to false). When auth is
    // present the singleton stays connected across re-renders — connecting
    // happens in the socket-push effect below, not here.
    if (!isAuthenticated) {
      notificationSocket.disconnect();
      return;
    }

    /**
     * Lightweight poll — fetches only the integer count, not full payloads.
     * Defined inside the effect (mirroring the App.jsx maintenance-poll pattern)
     * to avoid the react-hooks/set-state-in-effect lint rule.
     * Best-effort: silently ignores errors (badge stays at last known value).
     */
    async function pollUnreadCount() {
      try {
        const data = await getUnreadCount();
        setUnreadCount(data.unreadCount || 0);
      } catch {
        // Silently ignore poll failures — badge may lag but never blocks the user.
      }
    }

    // Initial fetch on mount so the badge appears immediately.
    pollUnreadCount();

    // Poll every 30 seconds as a fallback/reconciliation mechanism.
    // The socket handler (below) provides the zero-latency path.
    const interval = setInterval(pollUnreadCount, 30_000);
    return () => clearInterval(interval); // Clean up on unmount or auth change.
  }, [isAuthenticated]);

  // ── Real-time socket push ────────────────────────────────────────────────
  /**
   * Handles a `notification:new` push from the server.
   * Increments the badge and prepends the notification to the panel list if
   * the panel is currently open — so the user sees it without a reload.
   * Wrapped in useCallback so the same reference is passed to subscribe/unsubscribe.
   */
  const handleSocketNotification = useCallback((payload) => {
    setUnreadCount((prev) => prev + 1);
    // Prepend to the open panel list so it appears at the top immediately.
    setNotifications((prev) => {
      if (prev.length === 0) return prev; // Panel not yet loaded — skip prepend.
      return [
        {
          notificationId: payload.notificationId,
          notificationCategoryType: payload.category,
          discreetNotificationMessage: payload.message,
          notificationReadStatus: "UNREAD",
          notificationCreationTimestamp: payload.createdAt,
          relatedEntityType: payload.entityType,
          relatedEntityId: payload.entityId
        },
        ...prev
      ];
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Connect using the stored auth token and subscribe to push events.
    const token = getToken();
    if (token) {
      notificationSocket.connect(token);
    }
    notificationSocket.subscribe(handleSocketNotification);

    return () => {
      notificationSocket.unsubscribe(handleSocketNotification);
    };
  }, [isAuthenticated, handleSocketNotification]);

  // ── Outside-click handler ────────────────────────────────────────────────
  useEffect(() => {
    if (!panelOpen) return;

    /**
     * Closes the panel when the user clicks anywhere outside the component.
     * Attached to document on panel open and removed when panel closes.
     */
    function handleOutsideClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [panelOpen]);

  // ── Panel open / list fetch ──────────────────────────────────────────────
  /**
   * handleBellClick
   * Toggles the panel. On open, fetches the full notification list.
   */
  async function handleBellClick() {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }

    setPanelOpen(true);
    setLoading(true);
    setError(null);

    try {
      const data = await getNotifications();
      setNotifications(data.notifications || []);
      // Sync the badge with the count returned in the same response.
      setUnreadCount(data.unreadCount || 0);
    } catch {
      setError("Unable to load updates at the moment.");
    } finally {
      setLoading(false);
    }
  }

  // ── Notification actions ─────────────────────────────────────────────────
  /**
   * handleRowClick
   * Marks the notification as READ (if not already), decrements the badge,
   * then navigates to the chat/report/room/etc. it refers to and closes the
   * panel. Optimistically updates local state before awaiting the server call.
   *
   * @param {object} notification - The notification row object.
   */
  async function handleRowClick(notification) {
    if (notification.notificationReadStatus !== "READ") {
      // Optimistic local update — feel instant to the user.
      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notification.notificationId
            ? { ...n, notificationReadStatus: "READ" }
            : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        await markNotificationRead(notification.notificationId);
      } catch {
        // On failure, revert the optimistic update so the state stays consistent.
        setNotifications((prev) =>
          prev.map((n) =>
            n.notificationId === notification.notificationId
              ? { ...n, notificationReadStatus: "UNREAD" }
              : n
          )
        );
        setUnreadCount((prev) => prev + 1);
      }
    }

    const path = resolveNotificationPath(notification);
    if (path && onNavigate) {
      setPanelOpen(false);
      onNavigate(path);
    }
  }

  /**
   * handleDismiss
   * Hides a notification from the panel by marking it DISMISSED.
   * Removes the row from local state immediately (optimistic).
   *
   * @param {string} notificationId - UUID of the notification to dismiss.
   * @param {React.SyntheticEvent} e - Click event (stopped to prevent row click).
   */
  async function handleDismiss(notificationId, e) {
    e.stopPropagation(); // Don't trigger the row's mark-as-read handler.

    const dismissed = notifications.find((n) => n.notificationId === notificationId);

    // Optimistic: remove from panel immediately.
    setNotifications((prev) => prev.filter((n) => n.notificationId !== notificationId));

    // If the dismissed notification was unread, adjust the badge.
    if (dismissed?.notificationReadStatus === "UNREAD") {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    try {
      await dismissNotification(notificationId);
    } catch {
      // On failure, restore the notification at the top of the list.
      if (dismissed) {
        setNotifications((prev) => [dismissed, ...prev]);
        if (dismissed.notificationReadStatus === "UNREAD") {
          setUnreadCount((prev) => prev + 1);
        }
      }
    }
  }

  /**
   * handleMarkAllRead
   * Bulk-marks all unread notifications as READ, zeroes the badge, and clears
   * the panel list — the panel shows "No new updates." after the action so the
   * user gets clear confirmation that everything has been acknowledged.
   */
  async function handleMarkAllRead() {
    // Snapshot current list so we can restore on failure.
    const previous = notifications;

    // Optimistic update — clear the panel and zero the badge immediately.
    setNotifications([]);
    setUnreadCount(0);

    try {
      await markAllNotificationsRead();
    } catch {
      // On failure, restore the previous list and badge so state stays consistent.
      setNotifications(previous);
      setUnreadCount(previous.filter((n) => n.notificationReadStatus === "UNREAD").length);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (!isAuthenticated) return null;

  const hasUnread = unreadCount > 0;

  return (
    <div className="notification-bell-container" ref={containerRef}>
      {/* Bell button — shows numeric badge when there are unread notifications */}
      <button
        type="button"
        className="notification-bell-btn"
        onClick={handleBellClick}
        aria-label={hasUnread ? `${unreadCount} unread updates` : "Notification center"}
        title={hasUnread ? `${unreadCount} unread updates` : "No new updates"}
      >
        <Bell className="notification-bell-icon" size={20} aria-hidden="true" focusable="false" />
        {hasUnread && (
          <span className="notification-badge" aria-live="polite">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {panelOpen && (
        <div className="notification-panel" role="dialog" aria-label="Updates">
          {/* Panel header */}
          <div className="notification-panel-header">
            <span className="notification-panel-title">Updates</span>
            {hasUnread && (
              <button
                type="button"
                className="notification-mark-all-btn"
                onClick={handleMarkAllRead}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Panel body */}
          <div className="notification-panel-body">
            {loading && (
              <div aria-busy="true" aria-label="Loading notifications" style={{ padding: '0.5rem 0.75rem' }}>
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line" style={{ width: '80%' }} />
                <div className="skeleton skeleton-line" style={{ width: '65%' }} />
              </div>
            )}

            {!loading && error && (
              <p className="notification-empty notification-error">{error}</p>
            )}

            {!loading && !error && notifications.length === 0 && (
              <p className="notification-empty">No new updates.</p>
            )}

            {!loading && !error && notifications.map((notification) => (
              <div
                key={notification.notificationId}
                className={`notification-row${notification.notificationReadStatus === "UNREAD" ? " notification-row--unread" : ""}`}
                onClick={() => handleRowClick(notification)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleRowClick(notification)}
                aria-label={notification.discreetNotificationMessage}
              >
                <div className="notification-row-content">
                  {/* Category tag */}
                  <span className="notification-category-tag">
                    {getCategoryLabel(notification.notificationCategoryType)}
                  </span>

                  {/* Discreet message text */}
                  <p className="notification-message">
                    {notification.discreetNotificationMessage}
                  </p>

                  <span className="notification-time">
                    {formatNotificationTime(notification.notificationCreationTimestamp)}
                  </span>
                </div>

                {/* Dismiss button — stops propagation so it doesn't also mark-as-read */}
                <button
                  type="button"
                  className="notification-dismiss-btn"
                  onClick={(e) => handleDismiss(notification.notificationId, e)}
                  aria-label="Dismiss this update"
                  title="Dismiss"
                >
                  <X size={14} aria-hidden="true" focusable="false" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
