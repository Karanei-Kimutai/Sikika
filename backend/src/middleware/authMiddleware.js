const jwt = require("jsonwebtoken");
const { UserAccount } = require("../models");
const { liftExpiredBan } = require("../controllers/authController");

/**
 * JWT authentication middleware (async).
 *
 * Expects Authorization header in the form:
 *   Bearer <token>
 *
 * Verification steps:
 *  1. Extract and verify JWT — reject on missing/invalid/expired token.
 *  2. Load the user's accountStatus from the database (one indexed PK lookup).
 *     This ensures that bans and suspensions applied after the token was issued
 *     take effect on the very next request rather than waiting for token expiry.
 *  3. Auto-lift expired temporary bans (banExpiresAt in the past → ACTIVE).
 *  4. Reject BANNED, SUSPENDED, and DEACTIVATED accounts with HTTP 403.
 *  5. Attach decoded JWT claims to req.user and proceed.
 *
 * Behavior change vs. the former synchronous middleware:
 *   Previously, SUSPENDED/DEACTIVATED accounts with a valid token could still
 *   access the platform until the token expired. This middleware enforces
 *   lifecycle status immediately on every authenticated request.
 *
 * Route-specific behavior:
 *  - /api/reports returns a survivor-support response payload when auth is
 *    missing, so clients can redirect users toward emergency resources.
 *  - All other routes receive a generic 401 on missing/invalid auth.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  // --- 1. Token presence check -----------------------------------------------
  if (!header || !header.startsWith("Bearer ")) {
    if (req.originalUrl.startsWith("/api/reports")) {
      return res.status(401).json({
        error: "Reporting is only available for registered and authenticated survivors.",
        redirectTo: "/emergency-contacts",
        emergencyContacts: [
          "Police emergency: 999 / 112",
          "Childline Kenya: 116",
          "National GBV Hotline: 1195"
        ]
      });
    }

    return res.status(401).json({ error: "Missing or invalid authorization header." });
  }

  const token = header.slice("Bearer ".length).trim();

  // --- 2. JWT signature verification -----------------------------------------
  let decoded;
  try {
    // jwt.verify is synchronous and throws on invalid/expired tokens.
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  // --- 3. Real-time account status check (DB lookup) -------------------------
  // Resolves the userId from either claim name for backward compatibility.
  const userId = decoded?.userId || decoded?.id;
  if (!userId) {
    return res.status(401).json({ error: "Token payload is missing user identity." });
  }

  try {
    const user = await UserAccount.findByPk(userId, {
      attributes: ["userId", "accountStatus", "banReason", "banExpiresAt"]
    });

    if (!user) {
      // Account was deleted after the token was issued.
      return res.status(401).json({ error: "Account no longer exists." });
    }

    // Attempt to auto-lift an expired temporary ban before status enforcement.
    await liftExpiredBan(user);

    const status = String(user.accountStatus || "ACTIVE").toUpperCase();

    if (status === "BANNED") {
      // Surface discreet ban details — enough for UI feedback without exposing GBV context.
      return res.status(403).json({
        error: "This account has been suspended from the platform.",
        ...(user.banReason ? { reason: user.banReason } : {}),
        ...(user.banExpiresAt ? { expiresAt: user.banExpiresAt } : {})
      });
    }

    if (status === "SUSPENDED") {
      return res.status(403).json({
        error: "This account is currently suspended. Please contact support."
      });
    }

    if (status === "DEACTIVATED") {
      return res.status(403).json({
        error: "This account has been deactivated."
      });
    }
  } catch (dbError) {
    // DB failure during status check should not silently pass — fail closed.
    console.error("authMiddleware: DB status check failed:", dbError.message);
    return res.status(401).json({ error: "Could not verify account status. Please try again." });
  }

  // --- 4. Attach claims and proceed ------------------------------------------
  req.user = decoded;
  return next();
}

module.exports = authMiddleware;
