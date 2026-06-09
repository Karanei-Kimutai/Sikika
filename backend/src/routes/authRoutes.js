const express = require('express');
const router = express.Router();
const { requestOTP, verifyOTP } = require('../controllers/authController');

// POST request to /api/auth/request-otp
router.post('/request-otp', requestOTP);

// POST request to /api/auth/verify-otp
router.post('/verify-otp', verifyOTP);

module.exports = router;