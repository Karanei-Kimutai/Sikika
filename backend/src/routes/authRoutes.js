const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
	requestOTP,
	verifyOTP,
	loginWithPassword,
	requestPasswordReset,
	resetPasswordWithOtp,
	setPassword
} = require('../controllers/authController');
const { otpRequestLimiter, authSensitiveLimiter } = require('../middleware/authRateLimitMiddleware');

/**
 * Authentication API routes.
 *
 * Mounted at /api/auth from backend/index.js.
 * Endpoints:
 * - POST /request-otp: request SMS OTP
 * - POST /verify-otp: validate OTP and issue JWT
 * - POST /login-password: login using password
 * - POST /set-password: set password for authenticated user
 * - POST /forgot-password/request: request reset OTP
 * - POST /forgot-password/reset: verify OTP and reset password
 *
 * Rate limiter strategy:
 * - otpRequestLimiter: OTP issuance endpoints (higher abuse risk)
 * - authSensitiveLimiter: verify/login/reset endpoints
 */

// POST request to /api/auth/request-otp
router.post('/request-otp', otpRequestLimiter, requestOTP);

// POST request to /api/auth/verify-otp
// Verifies OTP for signin/signup intent and can complete first-time signup.
router.post('/verify-otp', authSensitiveLimiter, verifyOTP);

// POST request to /api/auth/login-password
router.post('/login-password', authSensitiveLimiter, loginWithPassword);

// POST request to /api/auth/forgot-password/request
// Sends a reset OTP while avoiding account enumeration leaks.
router.post('/forgot-password/request', otpRequestLimiter, requestPasswordReset);

// POST request to /api/auth/forgot-password/reset
// Validates reset OTP and writes a new hashed password.
router.post('/forgot-password/reset', authSensitiveLimiter, resetPasswordWithOtp);

// POST request to /api/auth/set-password
router.post('/set-password', authSensitiveLimiter, authMiddleware, setPassword);

module.exports = router;