const jwt = require("jsonwebtoken");

/**
 * JWT authentication middleware.
 *
 * Expects Authorization header in the form:
 *   Bearer <token>
 *
 * On success, decoded claims are attached to req.user.
 *
 * Route-specific behavior:
 * - /api/reports returns a survivor-support response payload when auth is
 *   missing, so clients can redirect users toward emergency resources.
 * - all other routes receive a generic 401 response on missing/invalid auth.
 */

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

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

  try {
    // JWT verification is synchronous; invalid/expired tokens throw.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = authMiddleware;
