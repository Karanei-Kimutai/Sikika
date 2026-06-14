const jwt = require("jsonwebtoken");
const { RoomMembership, UserAccount } = require("../models");
const { normalizeRole } = require("../utils/roles");

/**
 * Community socket gateway
 *
 * Auth model:
 * - Token is read from socket auth payload or Authorization header.
 * - Only active accounts can join rooms.
 * - Room join is membership-guarded; moderation feed is NGO-admin only.
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

function resolveUserIdFromTokenClaims(claims) {
  return claims?.userId || claims?.id || null;
}

module.exports = (io) => {
  io.on("connection", async (socket) => {
    const token = getTokenFromHandshake(socket);
    if (!token) return;

    let userId = null;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = resolveUserIdFromTokenClaims(decoded);
    } catch (error) {
      return;
    }

    if (!userId) return;

    const account = await UserAccount.findByPk(userId, {
      attributes: ["userId", "userRole", "accountStatus"]
    });

    if (!account || account.accountStatus !== "ACTIVE") {
      return;
    }

    socket.data.userId = account.userId;
    socket.data.role = normalizeRole(account.userRole);

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

    socket.on("joinModerationFeed", () => {
      if (socket.data.role !== "NGO_ADMIN") {
        socket.emit("community:error", { error: "Only NGO admins can access moderation feed." });
        return;
      }

      socket.join("community-moderation");
    });
  });
};
