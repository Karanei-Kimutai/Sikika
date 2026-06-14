/**
 * notificationSocket.js
 * ---------------------
 * Singleton Socket.io client for receiving real-time `notification:new` push
 * events from the backend.
 *
 * Design rationale:
 * - Module-level singleton (same pattern as CommunityPage / ModerationDashboardPage)
 *   so that multiple consumers (e.g. NotificationBell mounted in SiteHeader) share
 *   one connection rather than opening a new socket per component mount.
 * - `autoConnect: false` — the caller must call `connect()` after setting auth,
 *   which lets us defer the connection until the user is authenticated.
 * - The 30-second polling in NotificationBell is kept as a fallback / reconciliation
 *   mechanism. This socket push provides the zero-latency path.
 *
 * Usage:
 *   import notificationSocket from './notificationSocket';
 *   notificationSocket.connect(token);
 *   notificationSocket.subscribe(handler);  // handler({ notificationId, category, message, createdAt })
 *   notificationSocket.unsubscribe(handler);
 *   notificationSocket.disconnect();
 */

import { io } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/** @type {import('socket.io-client').Socket} */
const socket = io(API_BASE_URL, { autoConnect: false });

/** @type {Set<Function>} */
const _handlers = new Set();

socket.on("notification:new", (payload) => {
  _handlers.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error("[notificationSocket] handler error:", err);
    }
  });
});

socket.on("disconnect", () => {
  // Reconnect silently when the server drops the connection (e.g. server restart).
  // autoReconnect is enabled by default in socket.io-client.
});

const notificationSocket = {
  /**
   * Connect (or reconnect) using the given JWT.
   * Safe to call multiple times — socket.io is idempotent on connect if already open.
   *
   * @param {string} token - Auth JWT from sessionStorage.
   */
  connect(token) {
    socket.auth = { token };
    if (!socket.connected) {
      socket.connect();
    }
  },

  /** Disconnect the socket (called on sign-out or component unmount). */
  disconnect() {
    socket.disconnect();
  },

  /**
   * Register a handler for `notification:new` events.
   *
   * @param {(payload: {notificationId: string, category: string, message: string, createdAt: string}) => void} handler
   */
  subscribe(handler) {
    _handlers.add(handler);
  },

  /**
   * Remove a previously registered handler.
   *
   * @param {Function} handler
   */
  unsubscribe(handler) {
    _handlers.delete(handler);
  }
};

export default notificationSocket;
