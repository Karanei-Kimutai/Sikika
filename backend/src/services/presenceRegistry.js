/**
 * presenceRegistry.js
 * -------------------
 * Lightweight in-memory presence tracker for the chat socket layer.
 *
 * Why in-memory (and not DB-persisted)?
 * - Presence is inherently ephemeral: it resets on process restart anyway.
 * - DB writes per connect/disconnect would add latency to every chat connection.
 * - The registry only needs to live as long as the server process does.
 *
 * Structure: Map<userId, Set<socketId>>
 * A user is "online" when their Set is non-empty (handles multi-tab correctly).
 *
 * Effective presence semantics:
 *   connected + manual BUSY   → 'BUSY'    (in a session, signals reduced response speed)
 *   connected + manual other  → 'AVAILABLE'
 *   not connected             → 'OFFLINE'  (always overrides the manual DB setting)
 *
 * The manual `availabilityStatus` on counsellor/legalCounsel profiles still
 * governs admin/NGO dashboard views and candidate filtering. This module
 * derives the survivor-facing chat presence from actual socket connectivity.
 */

/** @type {Map<string, Set<string>>} Maps userId → Set of active socketIds */
const connectedUsers = new Map();

/**
 * Records that a socket connection is active for a given user.
 *
 * Idempotent — safe to call multiple times for the same socketId.
 *
 * @param {string} userId   - The authenticated user's UUID.
 * @param {string} socketId - The socket.io socket identifier.
 * @returns {boolean} True if this is the user's first active socket (they just came online).
 */
function markOnline(userId, socketId) {
  const wasOffline = !connectedUsers.has(userId) || connectedUsers.get(userId).size === 0;

  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Set());
  }
  connectedUsers.get(userId).add(socketId);

  return wasOffline;
}

/**
 * Records that a socket has disconnected for a given user.
 *
 * When the user's last socket disconnects, they are removed from the map entirely.
 *
 * @param {string} userId   - The authenticated user's UUID.
 * @param {string} socketId - The disconnecting socket identifier.
 * @returns {boolean} True if the user has no remaining active sockets (they just went offline).
 */
function markOffline(userId, socketId) {
  const sockets = connectedUsers.get(userId);
  if (!sockets) return false;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    connectedUsers.delete(userId);
    return true; // user is now fully offline
  }

  return false; // still has other open tabs/sockets
}

/**
 * Returns whether a user currently has at least one active socket connection.
 *
 * @param {string} userId - The user's UUID.
 * @returns {boolean}
 */
function isOnline(userId) {
  const sockets = connectedUsers.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

/**
 * Derives the effective presence label visible to a survivor in the chat UI.
 *
 * This combines the real socket-connectivity state (authoritative) with the
 * manually-set `availabilityStatus` DB enum (used as a secondary signal for BUSY).
 *
 * @param {string} userId       - The staff member's userId.
 * @param {string|null} manualStatus - The DB `availabilityStatus` value ('AVAILABLE'|'BUSY'|'OFFLINE').
 * @returns {'AVAILABLE'|'BUSY'|'OFFLINE'}
 */
function getEffectivePresence(userId, manualStatus) {
  if (!isOnline(userId)) {
    // Socket connectivity is the ground truth — offline overrides any DB setting.
    return 'OFFLINE';
  }

  // Staff is connected. Honour BUSY if they have manually set it, otherwise AVAILABLE.
  const normalised = String(manualStatus || '').trim().toUpperCase();
  if (normalised === 'BUSY') return 'BUSY';

  return 'AVAILABLE';
}

module.exports = {
  markOnline,
  markOffline,
  isOnline,
  getEffectivePresence
};
