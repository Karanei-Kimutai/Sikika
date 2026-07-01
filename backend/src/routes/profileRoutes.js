/**
 * profileRoutes.js
 * ----------------
 * Endpoints for reading and updating the authenticated user's own profile.
 * Both routes require a valid JWT and are scoped to the caller's own account —
 * users cannot read or modify each other's profiles.
 *
 * Mounted at /api/profile from backend/index.js.
 *
 * Route map:
 *   GET    /me  → return the caller's UserAccount + role-specific profile data
 *   PATCH  /me  → update allowed profile fields (availability, specialization, etc.)
 *
 * Role-specific fields returned by GET /me vary by userRole:
 *   SURVIVOR      → survivorProfile (nickname, county, assigned staff)
 *   COUNSELLOR    → counsellorProfile (specialization, workload, availability)
 *   LEGAL_COUNSEL → legalCounselProfile (specialization, workload, availability)
 *   NGO_ADMIN     → ngoAdministratorProfile (department, access level)
 *   MODERATOR     → moderatorProfile (workload score)
 */

const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getProfile, updateProfile } = require('../controllers/profileController');

const router = express.Router();

// All profile endpoints require an authenticated session.
router.use(authMiddleware);

// Return the caller's account + role-specific profile data.
router.get('/me', getProfile);

// Update mutable profile fields for the caller's role.
// Immutable fields (userId, role, phone number) are ignored even if supplied.
router.patch('/me', updateProfile);

module.exports = router;
