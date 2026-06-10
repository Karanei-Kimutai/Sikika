const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const sequelize = require('../config/database');
const {
    UserAccount,
    SurvivorProfile,
    CounsellorProfile,
    LegalCounselProfile,
    StaffAssignmentHistory
} = require('../models');

/**
 * Authentication controller
 *
 * Handles:
 * - OTP signup and OTP signin intents
 * - Password signin
 * - Forgot/reset password by OTP
 * - OTP expiry/retry limits and temporary lockouts
 */

const credentials = {
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME
};
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

// Security knobs are env-driven so ops can tighten limits without code changes.
const OTP_TTL_MS = Number(process.env.AUTH_OTP_TTL_MS || 10 * 60 * 1000);
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);
const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5);
const LOCKOUT_MS = Number(process.env.AUTH_LOCKOUT_MS || 15 * 60 * 1000);

const AUTH_STAGES = {
    OTP_VERIFICATION_REQUIRED: 'OTP_VERIFICATION_REQUIRED',
    PASSWORD_SETUP_REQUIRED: 'PASSWORD_SETUP_REQUIRED',
    SIGNUP_REQUIRED: 'SIGNUP_REQUIRED',
    SIGNIN_REQUIRED: 'SIGNIN_REQUIRED',
    PASSWORD_RESET_OTP_REQUIRED: 'PASSWORD_RESET_OTP_REQUIRED',
    AUTHENTICATED: 'AUTHENTICATED'
};

const AUTH_INTENTS = {
    SIGNIN_OTP: 'SIGNIN_OTP',
    SIGNUP_OTP: 'SIGNUP_OTP',
    PASSWORD_RESET: 'PASSWORD_RESET'
};

// Local/dev mode may bypass real SMS delivery while still exercising OTP flows.
function isLocalOtpMode() {
    return process.env.SKIP_SMS_IN_DEV === 'true' && process.env.NODE_ENV !== 'production';
}

// Extracts a user-safe error summary from external provider/sdk errors.
function getSafeErrorMessage(error) {
    return error.response?.data?.SMSMessageData?.Message ||
        error.response?.data?.message ||
        error.code ||
        error.message ||
        'Unknown error';
}

function getCanonicalRole(user) {
    return user.userRole || user.role;
}

// Normalizes accepted phone formats into a stable canonical representation.
function normalizePhoneNumber(phoneNumber) {
    const raw = String(phoneNumber || '').trim();
    if (!raw) return '';

    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');

    if (!digits) return raw;

    if (digits.startsWith('0') && digits.length === 10) {
        return `+254${digits.slice(1)}`;
    }

    if (digits.startsWith('254') && digits.length === 12) {
        return `+${digits}`;
    }

    return hasPlus ? `+${digits}` : raw;
}

// Restricts supported intents to known enum-like constants.
function resolveAuthIntent(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === AUTH_INTENTS.SIGNIN_OTP) return AUTH_INTENTS.SIGNIN_OTP;
    if (raw === AUTH_INTENTS.SIGNUP_OTP) return AUTH_INTENTS.SIGNUP_OTP;
    if (raw === AUTH_INTENTS.PASSWORD_RESET) return AUTH_INTENTS.PASSWORD_RESET;
    return null;
}

// Issues stateless JWT auth token consumed by frontend and middleware.
function issueAuthToken(user) {
    return jwt.sign(
        { id: user.userId, userId: user.userId, role: getCanonicalRole(user) },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
    );
}

// Returns true when account lockout is still active.
function isLocked(user) {
    return Boolean(user.authLockUntil && new Date(user.authLockUntil).getTime() > Date.now());
}

// Provides client-friendly countdown for lockout responses.
function getLockoutSecondsRemaining(user) {
    if (!user.authLockUntil) return 0;
    const ms = new Date(user.authLockUntil).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

// Increments password failure counters and applies lockout threshold.
async function registerPasswordFailure(user) {
    user.authFailedAttempts = (user.authFailedAttempts || 0) + 1;
    if (user.authFailedAttempts >= LOGIN_MAX_ATTEMPTS) {
        user.authFailedAttempts = 0;
        user.authLockUntil = new Date(Date.now() + LOCKOUT_MS);
    }
    await user.save();
}

// Clears lock/failure state after successful authentication.
async function clearPasswordFailureState(user) {
    if (!user.authFailedAttempts && !user.authLockUntil) return;
    user.authFailedAttempts = 0;
    user.authLockUntil = null;
    await user.save();
}

// Sets a fresh OTP with purpose, expiry, and reset attempt counter.
async function setOtpForUser(user, otpCode, purpose) {
    user.otpHash = otpCode;
    user.otpPurpose = purpose;
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.otpAttemptCount = 0;
    await user.save();
}

// Removes any active OTP state after success, expiry, or exhaustion.
async function clearOtpForUser(user) {
    user.otpHash = null;
    user.otpPurpose = null;
    user.otpExpiresAt = null;
    user.otpAttemptCount = 0;
    await user.save();
}

// Tracks OTP verification failures and locks account on exhaustion.
async function registerOtpFailure(user) {
    user.otpAttemptCount = (user.otpAttemptCount || 0) + 1;
    if (user.otpAttemptCount >= OTP_MAX_ATTEMPTS) {
        user.authFailedAttempts = 0;
        user.authLockUntil = new Date(Date.now() + LOCKOUT_MS);
        await clearOtpForUser(user);
        return { exhausted: true };
    }

    await user.save();
    return { exhausted: false };
}

// Sends OTP via SMS unless local/dev mode bypasses external provider calls.
async function sendOtpSms(phoneNumber, otpCode) {
    let warning = null;

    if (!isLocalOtpMode()) {
        const options = {
            to: [phoneNumber],
            message: `Your secure access code is: ${otpCode}. Do not share this code with anyone.`
        };

        try {
            await sms.send(options);
        } catch (error) {
            const safeMessage = getSafeErrorMessage(error);
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }

            warning = `SMS send failed in non-production mode: ${safeMessage}`;
            console.warn('SMS Warning:', warning);
        }
    }

    return warning;
}

// Builds a consistent OTP API response payload for all OTP-request endpoints.
function buildOtpResponse({ otpCode, warning, authStage, authIntent, message }) {
    const response = {
        message,
        authStage,
        authIntent
    };

    if (warning) response.warning = warning;
    if (isLocalOtpMode()) response.developmentOtp = otpCode;

    return response;
}

// Creates deterministic placeholder values for mandatory survivor profile fields
// when signup currently collects only phone/password/OTP.
function buildDefaultSurvivorProfileFields(user) {
    const shortId = String(user.userId || '').replace(/-/g, '').slice(0, 6) || 'new';
    return {
        displayNickname: `Survivor-${shortId}`,
        assignedGender: 'UNSPECIFIED',
        residenceCounty: 'UNSPECIFIED',
        privacyPreferencesJson: { notificationsEnabled: true }
    };
}

// Picks least-loaded staff member, preferring currently AVAILABLE or BUSY workers,
// then falling back to any profile if all staff are OFFLINE.
// Assumption: staff profiles are provisioned via NGO admin user-management flows.
// Signup logic here never promotes survivor role; it only links existing staff.
async function pickLeastLoadedStaff(ProfileModel, transaction) {
    const preferred = await ProfileModel.findOne({
        where: { availabilityStatus: { [Op.in]: ['AVAILABLE', 'BUSY'] } },
        order: [
            ['currentWorkloadScore', 'ASC'],
            ['createdAt', 'ASC']
        ],
        transaction
    });

    if (preferred) return preferred;

    return ProfileModel.findOne({
        order: [
            ['currentWorkloadScore', 'ASC'],
            ['createdAt', 'ASC']
        ],
        transaction
    });
}

// Ensures every newly completed survivor signup has a survivor profile, auto-assigned
// counsellor/legal counsel, and an assignment history record for auditing.
async function ensureSurvivorStaffAutoAssignment(user) {
    return sequelize.transaction(async (transaction) => {
        const existingProfile = await SurvivorProfile.findOne({
            where: { userId: user.userId },
            transaction
        });

        if (existingProfile) {
            return existingProfile;
        }

        const assignedCounsellor = await pickLeastLoadedStaff(CounsellorProfile, transaction);
        const assignedLegalCounsel = await pickLeastLoadedStaff(LegalCounselProfile, transaction);
        const defaults = buildDefaultSurvivorProfileFields(user);

        const survivorProfile = await SurvivorProfile.create({
            survivorId: randomUUID(),
            userId: user.userId,
            ...defaults,
            assignedCounsellorId: assignedCounsellor?.counsellorId || null,
            assignedLegalCounselId: assignedLegalCounsel?.legalCounselId || null
        }, { transaction });

        if (assignedCounsellor) {
            assignedCounsellor.currentWorkloadScore = (assignedCounsellor.currentWorkloadScore || 0) + 1;
            await assignedCounsellor.save({ transaction });
        }

        if (assignedLegalCounsel) {
            assignedLegalCounsel.currentWorkloadScore = (assignedLegalCounsel.currentWorkloadScore || 0) + 1;
            await assignedLegalCounsel.save({ transaction });
        }

        await StaffAssignmentHistory.create({
            assignmentHistoryId: randomUUID(),
            survivorId: survivorProfile.survivorId,
            counsellorId: assignedCounsellor?.counsellorId || null,
            legalCounselId: assignedLegalCounsel?.legalCounselId || null,
            assignmentReason: 'Initial auto-assignment at signup completion'
        }, { transaction });

        return survivorProfile;
    });
}

/**
 * POST /api/auth/request-otp
 *
 * Supports both signup and signin OTP intents and returns a stage/intent pair
 * the frontend can branch on deterministically.
 */
const requestOTP = async (req, res) => {
    const { phoneNumber, authIntent } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const resolvedIntent = resolveAuthIntent(authIntent);

    try {
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Phone number is required.' });
        }

        // Fetch account once so we can gate intent-specific behavior.
        let user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });

        if (resolvedIntent === AUTH_INTENTS.SIGNIN_OTP) {
            if (!user || !user.hashedPassword) {
                return res.status(409).json({
                    error: 'No completed account found for OTP sign in. Please create your account first.',
                    authStage: AUTH_STAGES.SIGNUP_REQUIRED,
                    suggestedAuthIntent: AUTH_INTENTS.SIGNUP_OTP
                });
            }
        }

        if (resolvedIntent === AUTH_INTENTS.SIGNUP_OTP && user?.hashedPassword) {
            return res.status(409).json({
                error: 'Account already has a password. Use sign in with OTP or password.',
                authStage: AUTH_STAGES.SIGNIN_REQUIRED,
                suggestedAuthIntent: AUTH_INTENTS.SIGNIN_OTP
            });
        }

        if (!user) {
            // Signup may bootstrap a survivor account during OTP request.
            user = await UserAccount.create({
                phoneNumber: normalizedPhone,
                userRole: 'SURVIVOR',
                role: 'survivor',
                status: 'active',
                accountStatus: 'ACTIVE'
            });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        const effectiveIntent = resolvedIntent || (user.hashedPassword ? AUTH_INTENTS.SIGNIN_OTP : AUTH_INTENTS.SIGNUP_OTP);

        await setOtpForUser(user, otpCode, effectiveIntent);
        const warning = await sendOtpSms(phoneNumber, otpCode);

        return res.status(200).json(buildOtpResponse({
            otpCode,
            warning,
            authStage: AUTH_STAGES.OTP_VERIFICATION_REQUIRED,
            authIntent: effectiveIntent,
            message: 'OTP generated successfully.'
        }));
    } catch (error) {
        const safeMessage = getSafeErrorMessage(error);
        console.error('SMS Sending Error:', safeMessage);
        return res.status(500).json({ error: 'Failed to send OTP', details: safeMessage });
    }
};

/**
 * POST /api/auth/verify-otp
 *
 * Verifies OTP against purpose+expiry, applies retry limits, and then:
 * - completes signup (when password provided for first-time account)
 * - or authenticates existing account by OTP signin
 */
const verifyOTP = async (req, res) => {
    const { phoneNumber, otp, password, authIntent } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const resolvedIntent = resolveAuthIntent(authIntent);

    try {
        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        const effectiveIntent = resolvedIntent || (user.hashedPassword ? AUTH_INTENTS.SIGNIN_OTP : AUTH_INTENTS.SIGNUP_OTP);

        // OTP must match both value and purpose to prevent cross-flow replay.
        if (!user.otpHash || !user.otpPurpose || user.otpPurpose !== effectiveIntent) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'OTP has expired. Request a new code.' });
        }

        if (user.otpHash !== otp) {
            const failure = await registerOtpFailure(user);
            if (failure.exhausted) {
                return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
            }

            return res.status(401).json({ error: 'Invalid OTP.' });
        }

        if (effectiveIntent === AUTH_INTENTS.SIGNUP_OTP && user.hashedPassword) {
            await clearOtpForUser(user);
            return res.status(409).json({
                error: 'This account already has a password. Use OTP sign in or password sign in.',
                authStage: AUTH_STAGES.SIGNIN_REQUIRED,
                suggestedAuthIntent: AUTH_INTENTS.SIGNIN_OTP
            });
        }

        if (effectiveIntent === AUTH_INTENTS.SIGNIN_OTP && !user.hashedPassword) {
            await clearOtpForUser(user);
            return res.status(409).json({
                error: 'This account has not completed signup. Verify OTP and create a password first.',
                authStage: AUTH_STAGES.SIGNUP_REQUIRED,
                suggestedAuthIntent: AUTH_INTENTS.SIGNUP_OTP
            });
        }

        const isFirstTimeSignup = !user.hashedPassword;

        if (isFirstTimeSignup) {
            // Signup path: OTP verification must include initial password setup.
            if (!password || password.length < 8) {
                return res.status(400).json({
                    error: 'Password is required and must be at least 8 characters for first-time setup.',
                    requiresPasswordSetup: true,
                    authStage: AUTH_STAGES.PASSWORD_SETUP_REQUIRED,
                    authIntent: AUTH_INTENTS.SIGNUP_OTP
                });
            }

            user.hashedPassword = await bcrypt.hash(password, 10);
        }

        user.isOtpVerified = true;
        user.authLockUntil = null;
        user.authFailedAttempts = 0;
        await clearOtpForUser(user);
        await user.save();

        if (effectiveIntent === AUTH_INTENTS.SIGNUP_OTP && isFirstTimeSignup) {
            await ensureSurvivorStaffAutoAssignment(user);
        }

        const token = issueAuthToken(user);

        return res.status(200).json({
            message: 'Login successful!',
            token,
            userId: user.userId,
            authStage: AUTH_STAGES.AUTHENTICATED,
            authIntent: effectiveIntent,
            authMethod: 'OTP',
            role: getCanonicalRole(user)
        });
    } catch (error) {
        console.error('Verification Error:', error);
        return res.status(500).json({ error: 'Server error during verification.' });
    }
};

/**
 * POST /api/auth/login-password
 *
 * Password-based sign in with per-account failure counters and temporary lock.
 */
const loginWithPassword = async (req, res) => {
    const { phoneNumber, password } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!normalizedPhone || !password) {
            return res.status(400).json({ error: 'Phone number and password are required.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });

        if (!user || !user.hashedPassword) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        const passwordMatches = await bcrypt.compare(password, user.hashedPassword);
        if (!passwordMatches) {
            await registerPasswordFailure(user);
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        await clearPasswordFailureState(user);

        const token = issueAuthToken(user);

        return res.status(200).json({
            message: 'Password login successful!',
            token,
            userId: user.userId,
            authStage: AUTH_STAGES.AUTHENTICATED,
            authMethod: 'PASSWORD',
            role: getCanonicalRole(user)
        });
    } catch (error) {
        console.error('Password Login Error:', error);
        return res.status(500).json({ error: 'Server error during password login.' });
    }
};

/**
 * POST /api/auth/forgot-password/request
 *
 * Sends password-reset OTP for existing accounts while keeping response shape
 * generic enough to avoid account enumeration.
 */
const requestPasswordReset = async (req, res) => {
    const { phoneNumber } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Phone number is required.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user || !user.hashedPassword) {
            return res.status(200).json({
                message: 'If an account exists for this number, a reset code has been sent.',
                authStage: AUTH_STAGES.PASSWORD_RESET_OTP_REQUIRED,
                authIntent: AUTH_INTENTS.PASSWORD_RESET
            });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        await setOtpForUser(user, otpCode, AUTH_INTENTS.PASSWORD_RESET);
        const warning = await sendOtpSms(phoneNumber, otpCode);

        return res.status(200).json(buildOtpResponse({
            otpCode,
            warning,
            authStage: AUTH_STAGES.PASSWORD_RESET_OTP_REQUIRED,
            authIntent: AUTH_INTENTS.PASSWORD_RESET,
            message: 'Password reset code sent successfully.'
        }));
    } catch (error) {
        const safeMessage = getSafeErrorMessage(error);
        console.error('Password Reset Request Error:', safeMessage);
        return res.status(500).json({ error: 'Failed to request password reset.', details: safeMessage });
    }
};

/**
 * POST /api/auth/forgot-password/reset
 *
 * Validates reset OTP and writes a new hashed password.
 */
const resetPasswordWithOtp = async (req, res) => {
    const { phoneNumber, otp, newPassword } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!normalizedPhone || !otp || !newPassword) {
            return res.status(400).json({ error: 'Phone number, OTP, and new password are required.' });
        }

        if (String(newPassword).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user || !user.hashedPassword) {
            return res.status(401).json({ error: 'Invalid reset request.' });
        }

        if (!user.otpHash || user.otpPurpose !== AUTH_INTENTS.PASSWORD_RESET) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'OTP has expired. Request a new code.' });
        }

        if (user.otpHash !== otp) {
            const failure = await registerOtpFailure(user);
            if (failure.exhausted) {
                return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
            }

            return res.status(401).json({ error: 'Invalid OTP.' });
        }

        user.hashedPassword = await bcrypt.hash(newPassword, 10);
        user.authFailedAttempts = 0;
        user.authLockUntil = null;
        await clearOtpForUser(user);
        await user.save();

        return res.status(200).json({ message: 'Password reset successful.' });
    } catch (error) {
        console.error('Password Reset Error:', error);
        return res.status(500).json({ error: 'Server error during password reset.' });
    }
};

/**
 * POST /api/auth/set-password
 *
 * Authenticated password set/reset endpoint for in-session users.
 */
const setPassword = async (req, res) => {
    const { password } = req.body;

    try {
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const user = await UserAccount.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        user.hashedPassword = await bcrypt.hash(password, 10);
        await user.save();

        return res.status(200).json({ message: 'Password set successfully.' });
    } catch (error) {
        console.error('Set Password Error:', error);
        return res.status(500).json({ error: 'Server error while setting password.' });
    }
};

module.exports = {
    requestOTP,
    verifyOTP,
    loginWithPassword,
    requestPasswordReset,
    resetPasswordWithOtp,
    setPassword,
    AUTH_STAGES,
    AUTH_INTENTS
};
