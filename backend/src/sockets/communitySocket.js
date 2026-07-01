/**
 * communitySocket.js
 * ------------------
 * Socket.io handler for real-time community room events.
 *
 * This module is mounted on the default Socket.io namespace (no separate namespace).
 * It handles client-side room subscriptions — real-time message delivery is broadcast
 * from communityController.js via `io.to(room).emit(...)`.
 *
 * Socket events (client → server):
 *   joinCommunityRoom  { roomId }   — subscribe to a room; rejected if not a member
 *   joinModerationFeed              — subscribe to the moderation broadcast room (NGO_ADMIN only)
 *
 * Socket events (server → client):
 *   community:new-message      — broadcast when a new message is posted in a joined room
 *   community:message-updated  — broadcast when a message is edited (currently unused)
 *   community:message-deleted  — broadcast when a moderator deletes a message
 *   community:error            — sent to the requesting socket on auth or membership failure
 *
 * Auth model:
 *   JWT is read from `socket.handshake.auth.token` or the `Authorization: Bearer` header.
 *   Unauthenticated or non-ACTIVE connections are silently dropped.
 *   Room membership is verified before the socket joins a room room.
 */

const jwt = require("jsonwebtoken");
const { RoomMembership, UserAccount } = require("../models");
const { normalizeRole } = require("../utils/roles");

/**
 * Extracts the JWT string from the socket handshake.
 * Checks `socket.handshake.auth.token` first (preferred), then falls back to
 * the `Authorization: Bearer` HTTP upgrade header.
 *
 * @param {import('socket.io').Socket} socket
 * @returns {string|null} The raw JWT string, or null if none was provided.
 */
function getTokenFromHandshake(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake?.headers?.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return null;
}

/**
 * Resolves the user's UUID from decoded JWT claims.
 * Handles both 'userId' and 'id' claim names for backward compatibility.
 *
 * @param {object|null} claims - Decoded JWT payload from jwt.verify().
 * @returns {string|null} The UserAccount.userId string, or null.
 */
function resolveUserIdFromTokenClaims(claims) {
  return claims?.userId || claims?.id || null;
}

/**
 * Registers community socket event handlers on the Socket.io server.
 *
 * @param {import('socket.io').Server} io - The Socket.io server instance.
 */
module.exports = (io) => {
  io.on("connection", async (socket) => {
    // Silently drop unauthenticated connections — no event is emitted back.
    const token = getTokenFromHandshake(socket);
    if (!token) return;

    let userId = null;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = resolveUserIdFromTokenClaims(decoded);
    } catch (error) {
      // Invalid or expired token — drop silently.
      return;
    }

    if (!userId) return;

    // Re-verify account status from DB so banned/suspended sessions cannot use sockets.
    const account = await UserAccount.findByPk(userId, {
      attributes: ["userId", "userRole", "accountStatus"]
    });

    if (!account || account.accountStatus !== "ACTIVE") {
      return;
    }

    socket.data.userId = account.userId;
    socket.data.role = normalizeRole(account.userRole);

    /**
     * joinCommunityRoom — subscribe to a community room's broadcast channel.
     * Rejected with `community:error` when the user hasn't joined the room via
     * the REST API (POST /api/community/rooms/:roomId/join) first.
     *
     * @param {string} roomId - CommunityRoom.roomId to subscribe to.
     */
    socket.on("joinCommunityRoom", async (roomId) => {
      if (!roomId) return;

      const isMember = await RoomMembership.findOne({
        where: {
          roomId,
          userId: socket.data.userId
        }
      });

      if (!isMember) {
        socket.emit("community:error", { error: "Join the room first." });
        return;
      }

      // Namespace rooms by domain prefix to avoid collisions with direct-chat IDs.
      socket.join(`community-room:${roomId}`);
    });

    /**
     * joinModerationFeed — subscribe to the moderation broadcast room.
     * Allows NGO_ADMIN users to receive real-time moderation events without
     * polling. Rejected for all other roles.
     */
    socket.on("joinModerationFeed", () => {
      if (socket.data.role !== "NGO_ADMIN") {
        socket.emit("community:error", { error: "Only NGO admins can access moderation feed." });
        return;
      }

      socket.join("community-moderation");
    });
  });
};
