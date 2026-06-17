const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { handleCallback, listCallbackRequests, getMyCallbackRequests, updateCallbackRequest } = require('../controllers/ussdController');

/**
 * ussdRoutes.js
 * -------------
 * Mounted at /api/ussd.
 *
 * POST /callback
 *   Public — Africa's Talking posts here for every USSD interaction.
 *   No auth middleware; AT does not sign USSD requests. A reverse-proxy
 *   IP allowlist (AT IP ranges) is recommended in production.
 *
 * GET  /callback-requests
 *   NGO admin endpoint — the full callback queue across all counsellors.
 * GET  /my-callback-requests
 *   Counsellor endpoint — only the requests auto-assigned to the caller.
 * PATCH /callback-requests/:requestId
 *   NGO admin can fulfil any request; a counsellor can only fulfil one
 *   that is auto-assigned to them (enforced in the controller).
 */

const router = express.Router();

// AT-facing webhook — no auth
router.post('/callback', handleCallback);

// NGO admin management endpoints
router.get('/callback-requests', authMiddleware, listCallbackRequests);
router.get('/my-callback-requests', authMiddleware, getMyCallbackRequests);
router.patch('/callback-requests/:requestId', authMiddleware, updateCallbackRequest);

module.exports = router;
