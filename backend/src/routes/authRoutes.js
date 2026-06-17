const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
	requestOTP,
	verifyOTP,
	completeSignup,
	loginWithPassword,
	verify2FA,
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
 * - POST /request-otp: request SMS OTP (signup phone verification)
 * - POST /verify-otp: validate signup OTP, issue a short-lived signup ticket
 * - POST /complete-signup: validate signup ticket, set password + profile, issue JWT
 * - POST /login-password: phone+password signin; sends a 2FA OTP instead of a JWT
 * - POST /verify-2fa: validate the 2FA OTP from login-password and issue JWT
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
// Verifies the signup OTP and issues a short-lived signup ticket (no JWT yet).
router.post('/verify-otp', authSensitiveLimiter, verifyOTP);

// POST request to /api/auth/complete-signup
// Validates the signup ticket, sets password + profile details, issues JWT.
router.post('/complete-signup', authSensitiveLimiter, completeSignup);

// POST request to /api/auth/login-password
// Validates password and sends a 2FA OTP — does not issue a JWT directly.
router.post('/login-password', authSensitiveLimiter, loginWithPassword);

// POST request to /api/auth/verify-2fa
// Validates the 2FA OTP sent by login-password and issues the JWT.
router.post('/verify-2fa', authSensitiveLimiter, verify2FA);

// POST request to /api/auth/forgot-password/request
// Sends a reset OTP while avoiding account enumeration leaks.
router.post('/forgot-password/request', otpRequestLimiter, requestPasswordReset);

// POST request to /api/auth/forgot-password/reset
// Validates reset OTP and writes a new hashed password.
router.post('/forgot-password/reset', authSensitiveLimiter, resetPasswordWithOtp);

// POST request to /api/auth/set-password
router.post('/set-password', authSensitiveLimiter, authMiddleware, setPassword);

module.exports = router;