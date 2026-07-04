/**
 * socketAuthService.js
 * --------------------
 * Shared JWT/account-status helpers for Socket.io connection handlers.
 *
 * Extracted from chatSocket.js so communitySocket.js can reuse the same
 * mid-session accountStatus recheck instead of relying solely on the
 * connection-time check plus the incidental ban-eviction coupling through
 * chatSocket.js's `user:<userId>` room join.
 */

const { UserAccount } = require('../models');

/**
 * Extracts the JWT from either the socket.io auth object or the Authorization header.
 *
 * @param {import('socket.io').Socket} socket
 * @returns {string|null}
 */
function getTokenFromHandshake(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake?.headers?.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  return null;
}

/**
 * Resolves the canonical userId from either JWT claim shape (legacy `id` or current `userId`).
 *
 * @param {object} claims - Decoded JWT payload.
 * @returns {string|null}
 */
function resolveUserIdFromTokenClaims(claims) {
  return claims?.userId || claims?.id || null;
}

/**
 * isUserAccountActive
 * -------------------
 * Looks up the user's current accountStatus in the database.
 * Used to enforce bans and suspensions mid-session for sockets,
 * where JWT-based auth alone cannot reflect post-issue status changes.
 *
 * Returns true only for ACTIVE accounts. Returns false (and should
 * disconnect/reject the socket) for any other status.
 *
 * @param {string} userId - The user's UUID from the verified JWT.
 * @returns {Promise<boolean>}
 */
async function isUserAccountActive(userId) {
  try {
    const user = await UserAccount.findByPk(userId, {
      attributes: ['accountStatus']
    });
    // Only ACTIVE accounts may send messages. BANNED/SUSPENDED/DEACTIVATED are all rejected.
    return user && String(user.accountStatus || '').toUpperCase() === 'ACTIVE';
  } catch {
    // Fail closed: if we can't check, deny access.
    return false;
  }
}

module.exports = {
  getTokenFromHandshake,
  resolveUserIdFromTokenClaims,
  isUserAccountActive
};
