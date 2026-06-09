const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requestOTP, verifyOTP, loginWithPassword, setPassword } = require('../controllers/authController');

// POST request to /api/auth/request-otp
router.post('/request-otp', requestOTP);

// POST request to /api/auth/verify-otp
router.post('/verify-otp', verifyOTP);

// POST request to /api/auth/login-password
router.post('/login-password', loginWithPassword);

// POST request to /api/auth/set-password
router.post('/set-password', authMiddleware, setPassword);

module.exports = router;