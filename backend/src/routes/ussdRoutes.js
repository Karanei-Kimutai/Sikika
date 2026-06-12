const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { handleCallback, listCallbackRequests, updateCallbackRequest } = require('../controllers/ussdController');

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
 * PATCH /callback-requests/:requestId
 *   NGO admin endpoints to view and fulfil callback requests that
 *   originated from USSD sessions.
 */

const router = express.Router();

// AT-facing webhook — no auth
router.post('/callback', handleCallback);

// NGO admin management endpoints
router.get('/callback-requests', authMiddleware, listCallbackRequests);
router.patch('/callback-requests/:requestId', authMiddleware, updateCallbackRequest);

module.exports = router;
