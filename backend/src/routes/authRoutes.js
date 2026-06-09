const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requestOTP, verifyOTP, loginWithPassword, setPassword } = require('../controllers/authController');

/**
 * Authentication API routes.
 *
 * Mounted at /api/auth from backend/index.js.
 * Endpoints:
 * - POST /request-otp: request SMS OTP
 * - POST /verify-otp: validate OTP and issue JWT
 * - POST /login-password: login using password
 * - POST /set-password: set password for authenticated user
 */

// POST request to /api/auth/request-otp
router.post('/request-otp', requestOTP);

// POST request to /api/auth/verify-otp
router.post('/verify-otp', verifyOTP);

// POST request to /api/auth/login-password
router.post('/login-password', loginWithPassword);

// POST request to /api/auth/set-password
router.post('/set-password', authMiddleware, setPassword);

module.exports = router;