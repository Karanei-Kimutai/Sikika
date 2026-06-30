const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const { randomUUID, randomInt } = require('crypto');
const sequelize = require('../config/database');
const {
    UserAccount,
    SurvivorProfile,
    CounsellorProfile,
    LegalCounselProfile,
    StaffAssignmentHistory
} = require('../models');
const { ensureAutoChannelsForSurvivor } = require('../services/chatAccessService');

/**
 * authController.js
 * -----------------
 * Central authentication controller for Sikika.
 *
 * Handles all authentication entry points:
 * - OTP-based signup (phone verification + password creation)
 * - OTP-based signin (for users who prefer not to type a password)
 * - Password-based signin
 * - Forgot-password OTP flow
 * - In-session forced password set (for staff whose accounts are provisioned by an admin)
 *
 * Security model:
 * - OTPs are bcrypt-hashed before storage; plaintext is never persisted.
 * - OTPs are purpose-bound (SIGNUP_OTP / SIGNIN_OTP / PASSWORD_RESET) to prevent
 *   cross-flow replay attacks (e.g. using a signup OTP to reset a password).
 * - Both OTP and password paths share the same lockout mechanism:
 *   5 consecutive failures trigger a 15-minute account lock (env-configurable).
 * - BANNED accounts surface the ban reason in the response; SUSPENDED/DEACTIVATED
 *   receive a generic message to avoid leaking enforcement metadata.
 * - JWT tokens carry both `id` and `userId` for backwards compatibility with
 *   middleware that may read either field.
 *
 * External dependency: Africa's Talking SMS API (sandbox or live, controlled by
 * AFRICASTALKING_USERNAME). In local dev, set SKIP_SMS_IN_DEV=true to bypass
 * the SMS send and receive the plaintext OTP in the response body instead.
 */

const credentials = {
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME
};

// SDK is initialised once at module load — not per request — to avoid
// re-establishing the underlying HTTP client on every OTP send.
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

// ---------------------------------------------------------------------------
// Security knobs — all env-driven so ops can tighten limits without deploys.
// ---------------------------------------------------------------------------

/** How long (ms) an OTP remains valid before the user must request a new one. Default: 10 min. */
const OTP_TTL_MS = Number(process.env.AUTH_OTP_TTL_MS || 10 * 60 * 1000);

/** Maximum OTP verification attempts before the account is locked and the OTP is voided. Default: 5. */
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);

/** Maximum consecutive password failures before a temporary account lock. Default: 5. */
const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5);

/** How long (ms) an account stays locked after exhausting attempts. Default: 15 min. */
const LOCKOUT_MS = Number(process.env.AUTH_LOCKOUT_MS || 15 * 60 * 1000);

// ---------------------------------------------------------------------------
// Auth stage and intent constants
// ---------------------------------------------------------------------------

/**
 * AUTH_STAGES
 * -----------
 * Deterministic stage labels returned in every auth response so the frontend
 * can branch without inspecting error messages or HTTP status codes.
 *
 * - OTP_VERIFICATION_REQUIRED   : OTP has been sent; frontend should show the OTP input.
 * - DETAILS_REQUIRED            : Signup OTP verified; frontend must collect password + profile
 *                                 details and call complete-signup (a signup ticket is returned
 *                                 alongside this stage and must be echoed back).
 * - OTP_2FA_REQUIRED            : Password matched on signin; a 2FA OTP has been sent and the
 *                                 frontend must collect it and call verify-2fa to receive a JWT.
 * - PASSWORD_RESET_REQUIRED     : Account flagged for forced reset (staff provisioned by admin).
 * - SIGNUP_REQUIRED             : Phone has no completed account; user must sign up.
 * - SIGNIN_REQUIRED             : Account already exists; user should sign in, not sign up.
 * - PASSWORD_RESET_OTP_REQUIRED : Forgot-password OTP sent; frontend should show OTP + new-password fields.
 * - AUTHENTICATED               : Auth complete; JWT issued; user may proceed.
 */
const AUTH_STAGES = {
    OTP_VERIFICATION_REQUIRED: 'OTP_VERIFICATION_REQUIRED',
    DETAILS_REQUIRED: 'DETAILS_REQUIRED',
    OTP_2FA_REQUIRED: 'OTP_2FA_REQUIRED',
    PASSWORD_RESET_REQUIRED: 'PASSWORD_RESET_REQUIRED',
    SIGNUP_REQUIRED: 'SIGNUP_REQUIRED',
    SIGNIN_REQUIRED: 'SIGNIN_REQUIRED',
    PASSWORD_RESET_OTP_REQUIRED: 'PASSWORD_RESET_OTP_REQUIRED',
    AUTHENTICATED: 'AUTHENTICATED'
};

/**
 * AUTH_INTENTS
 * ------------
 * Purpose values stored as `otpPurpose` on the account so OTP/ticket verification
 * can confirm a code is being consumed in the same flow it was issued for
 * (cross-flow replay prevention).
 *
 * - SIGNUP_OTP     : OTP requested as part of new-account phone verification. Caller-supplied.
 * - SIGNUP_TICKET  : Short-lived ticket issued after SIGNUP_OTP succeeds, authorizing the
 *                    one remaining step (password + profile details) without re-sending an OTP.
 *                    Never caller-supplied as an intent — only ever set server-side.
 * - SIGNIN_2FA     : OTP sent automatically after a successful password match on signin.
 *                    Never caller-supplied as an intent — only ever set server-side.
 * - PASSWORD_RESET : OTP requested to authorize a forgotten-password reset. Caller-supplied.
 */
const AUTH_INTENTS = {
    SIGNUP_OTP: 'SIGNUP_OTP',
    SIGNUP_TICKET: 'SIGNUP_TICKET',
    SIGNIN_2FA: 'SIGNIN_2FA',
    PASSWORD_RESET: 'PASSWORD_RESET'
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * isLocalOtpMode
 * --------------
 * Returns true when the environment is configured for local development OTP bypass.
 * In this mode, no SMS is sent via Africa's Talking; instead, the plaintext OTP
 * is returned in the response body as `developmentOtp`.
 *
 * Both conditions must be true:
 * - SKIP_SMS_IN_DEV=true (explicit opt-in)
 * - NODE_ENV !== 'production' (safety guard: can never activate in prod)
 *
 * @returns {boolean}
 */
function isLocalOtpMode() {
    return process.env.SKIP_SMS_IN_DEV === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * getSafeErrorMessage
 * -------------------
 * Extracts a human-readable error string from Africa's Talking SDK errors,
 * which may be Axios HTTP errors (with a response body) or plain Error objects.
 * Falls back to a generic string if no message can be extracted.
 *
 * @param {Error} error - The caught error from the SMS SDK or other async call.
 * @returns {string} A user-safe error summary string.
 */
function getSafeErrorMessage(error) {
    return error.response?.data?.SMSMessageData?.Message ||
        error.response?.data?.message ||
        error.code ||
        error.message ||
        'Unknown error';
}

/**
 * getSmsDeliveryFailure
 * ---------------------
 * Africa's Talking can return HTTP 200 while still rejecting one or more
 * recipients in the response body. This function inspects the recipients array
 * and returns a failure description if any entry was not successfully delivered.
 *
 * A recipient is considered successful when:
 * - status (case-insensitive) === 'success', OR
 * - statusCode === 100 (submitted to carrier) or 101 (sent to handset)
 *
 * @param {object} smsResponse - The raw response object from sms.send().
 * @returns {string|null} A failure description string, or null if all recipients succeeded.
 */
function getSmsDeliveryFailure(smsResponse) {
    const recipients = smsResponse?.SMSMessageData?.Recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return 'SMS provider returned no recipient delivery data.';
    }

    const isRecipientSuccess = (entry) => {
        const normalizedStatus = String(entry?.status || '').trim().toLowerCase();
        const statusCode = Number(entry?.statusCode);
        if (normalizedStatus === 'success') return true;
        return statusCode === 100 || statusCode === 101;
    };

    const failedRecipient = recipients.find((entry) => {
        return !isRecipientSuccess(entry);
    });

    if (!failedRecipient) return null;

    const status = failedRecipient.status || 'Rejected';
    const code = failedRecipient.statusCode ?? 'unknown';
    return `SMS delivery rejected: ${status} (code ${code}).`;
}

/**
 * getCanonicalRole
 * ----------------
 * Returns the user's role from whichever field is populated. The model carries
 * both `userRole` (ENUM, primary) and `role` (legacy string) for historical
 * compatibility with older JWT payloads and seeded data.
 *
 * @param {UserAccount} user - UserAccount model instance or plain object.
 * @returns {string} The user's role string.
 */
function getCanonicalRole(user) {
    return user.userRole || user.role;
}

/**
 * isAccountActive
 * ---------------
 * Returns true only for accounts in the ACTIVE lifecycle state.
 *
 * Uses an allowlist (rather than a blocklist) so any new non-ACTIVE status
 * automatically blocks access without a code change.
 *
 * States blocked:
 * - SUSPENDED   : reversible operational block (e.g. staff temporarily deactivated by NGO admin).
 * - DEACTIVATED : soft-deleted account.
 * - BANNED      : explicit safety/moderation enforcement; may carry a time-limited expiry.
 *
 * IMPORTANT: for BANNED accounts, callers should surface banReason so the user
 * understands why access was denied rather than receiving a generic error.
 *
 * @param {object} user - UserAccount model instance or plain object with accountStatus.
 * @returns {boolean} true only when accountStatus is exactly 'ACTIVE'.
 */
function isAccountActive(user) {
    const status = String(user?.accountStatus || 'ACTIVE').toUpperCase();
    // Allowlist: only ACTIVE accounts have full platform access.
    return status === 'ACTIVE';
}

/**
 * liftExpiredBan
 * --------------
 * Checks whether a BANNED account has a past-expiry temporary ban and, if so,
 * auto-restores it to ACTIVE by clearing all ban metadata fields.
 *
 * Called at the top of every auth check (verifyOTP, loginWithPassword) and also
 * in authMiddleware so that a ban expiry is honoured on the very next request
 * after the expiry time passes — no cron job required.
 *
 * Permanent bans (banExpiresAt is null) are never auto-lifted.
 *
 * @param {UserAccount} user - Sequelize UserAccount instance loaded with ban fields.
 * @returns {Promise<boolean>} true if the ban was lifted and accountStatus changed to ACTIVE.
 */
async function liftExpiredBan(user) {
    if (!user || user.accountStatus !== 'BANNED') return false;
    if (!user.banExpiresAt) return false; // Permanent ban — no auto-lift.

    const now = new Date();
    if (new Date(user.banExpiresAt) > now) return false; // Ban still active.

    // Temporary ban has expired — restore the account to full access.
    user.accountStatus = 'ACTIVE';
    user.banReason = null;
    user.bannedAt = null;
    user.banExpiresAt = null;
    user.bannedByUserId = null;
    await user.save();
    return true;
}

/**
 * normalizePhoneNumber
 * --------------------
 * Converts a phone number in any common Kenyan format into a stable E.164
 * canonical form (+254XXXXXXXXX) that Africa's Talking requires.
 *
 * Handled formats:
 * - 0711000001    (local 10-digit starting with 0)  → +254711000001
 * - 254711000001  (12-digit without plus)            → +254711000001
 * - +254711000001 (already canonical)                → +254711000001
 *
 * Non-Kenyan numbers with a leading + are passed through as-is after stripping
 * non-digit characters. Unrecognised formats are returned unchanged.
 *
 * @param {string} phoneNumber - Raw phone number string from user input.
 * @returns {string} Normalized E.164 phone number, or empty string if input was blank.
 */
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

/**
 * resolveAuthIntent
 * -----------------
 * Validates the caller-supplied authIntent string against the subset of
 * AUTH_INTENTS that clients are allowed to request directly. SIGNUP_TICKET
 * and SIGNIN_2FA are deliberately excluded — those are only ever set
 * server-side as part of the signup-completion and signin-2FA steps, never
 * requested by a caller. Returns null for any unrecognised or missing value
 * so callers can apply a safe default.
 *
 * @param {string} value - Raw authIntent string from the request body.
 * @returns {string|null} A known client-facing AUTH_INTENTS value, or null.
 */
function resolveAuthIntent(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === AUTH_INTENTS.SIGNUP_OTP) return AUTH_INTENTS.SIGNUP_OTP;
    if (raw === AUTH_INTENTS.PASSWORD_RESET) return AUTH_INTENTS.PASSWORD_RESET;
    return null;
}

/**
 * issueAuthToken
 * --------------
 * Signs and returns a 2-hour JWT containing the user's ID and role.
 * Both `id` and `userId` are included in the payload for backwards compatibility
 * with authMiddleware variants that may read either field.
 *
 * @param {UserAccount} user - Authenticated UserAccount instance.
 * @returns {string} Signed JWT string.
 */
function issueAuthToken(user) {
    return jwt.sign(
        { id: user.userId, userId: user.userId, role: getCanonicalRole(user) },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
    );
}

/**
 * isLocked
 * --------
 * Returns true if the account is currently under a temporary auth lockout
 * (i.e. authLockUntil is set and is still in the future).
 *
 * @param {UserAccount} user - UserAccount instance.
 * @returns {boolean}
 */
function isLocked(user) {
    return Boolean(user.authLockUntil && new Date(user.authLockUntil).getTime() > Date.now());
}

/**
 * getLockoutSecondsRemaining
 * --------------------------
 * Computes how many seconds remain in the current lockout period.
 * Used to populate `retryAfterSeconds` in 423 responses so the frontend can
 * display a countdown without polling.
 *
 * @param {UserAccount} user - UserAccount instance with authLockUntil set.
 * @returns {number} Whole seconds remaining (0 if lock has already expired).
 */
function getLockoutSecondsRemaining(user) {
    if (!user.authLockUntil) return 0;
    const ms = new Date(user.authLockUntil).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * registerPasswordFailure
 * -----------------------
 * Increments the per-account password failure counter and, when the threshold
 * is reached, applies a temporary lockout.
 *
 * The failure counter is reset to 0 when the lockout is applied so that the
 * next lockout period starts fresh rather than inheriting accumulated failures.
 *
 * @param {UserAccount} user - UserAccount instance (mutated and saved).
 * @returns {Promise<void>}
 */
async function registerPasswordFailure(user) {
    user.authFailedAttempts = (user.authFailedAttempts || 0) + 1;
    if (user.authFailedAttempts >= LOGIN_MAX_ATTEMPTS) {
        user.authFailedAttempts = 0;
        user.authLockUntil = new Date(Date.now() + LOCKOUT_MS);
    }
    await user.save();
}

/**
 * clearPasswordFailureState
 * -------------------------
 * Resets failure counters and clears any expired lockout after a successful
 * password authentication. No-ops if the counters are already clean to avoid
 * an unnecessary DB write.
 *
 * @param {UserAccount} user - UserAccount instance (conditionally mutated and saved).
 * @returns {Promise<void>}
 */
async function clearPasswordFailureState(user) {
    if (!user.authFailedAttempts && !user.authLockUntil) return;
    user.authFailedAttempts = 0;
    user.authLockUntil = null;
    await user.save();
}

/**
 * setOtpForUser
 * -------------
 * Generates and stores a fresh OTP on the account:
 * - Hashes the plaintext OTP with bcrypt (10 rounds) before storage so the DB
 *   never contains a readable code — critical on a GBV safety platform where
 *   a DB breach must not also expose active auth codes.
 * - Stores the flow purpose so verifyOTP can confirm the OTP is being consumed
 *   in the same flow it was issued for (cross-flow replay prevention).
 * - Resets the OTP attempt counter so the new code gets a fresh 5-attempt budget.
 *
 * @param {UserAccount} user    - UserAccount instance (mutated and saved).
 * @param {string}      otpCode - Plaintext 4-digit OTP string.
 * @param {string}      purpose - One of AUTH_INTENTS (SIGNUP_OTP / SIGNIN_OTP / PASSWORD_RESET).
 * @returns {Promise<void>}
 */
async function setOtpForUser(user, otpCode, purpose) {
    user.otpHash = await bcrypt.hash(otpCode, 10);
    user.otpPurpose = purpose;
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.otpAttemptCount = 0;
    await user.save();
}

/**
 * clearOtpForUser
 * ---------------
 * Wipes all OTP-related fields on the account after the code has been
 * consumed (successfully or by exhaustion/expiry). Ensures a code cannot
 * be replayed after first use.
 *
 * @param {UserAccount} user - UserAccount instance (mutated and saved).
 * @returns {Promise<void>}
 */
async function clearOtpForUser(user) {
    user.otpHash = null;
    user.otpPurpose = null;
    user.otpExpiresAt = null;
    user.otpAttemptCount = 0;
    await user.save();
}

/**
 * registerOtpFailure
 * ------------------
 * Increments the OTP attempt counter. When the limit is reached, the account
 * is locked and the OTP is voided so the user must request a new code.
 *
 * Unlike password failures, OTP exhaustion clears authFailedAttempts before
 * applying the lockout — the two counters track separate failure surfaces.
 *
 * @param {UserAccount} user - UserAccount instance (mutated and saved).
 * @returns {Promise<{exhausted: boolean}>} exhausted: true when the OTP budget is spent.
 */
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

/**
 * sendOtpSms
 * ----------
 * Sends the plaintext OTP to the given phone number via Africa's Talking SMS.
 *
 * Dev bypass: when SKIP_SMS_IN_DEV=true and NODE_ENV !== 'production', the
 * Africa's Talking call is skipped entirely. The plaintext OTP is exposed in
 * the API response body instead (see buildOtpResponse).
 *
 * Delivery verification: Africa's Talking can return HTTP 200 while rejecting
 * a recipient. getSmsDeliveryFailure inspects the per-recipient status entries
 * and throws if any failed.
 *
 * Error handling:
 * - In production: all errors are re-thrown and result in HTTP 500.
 * - In non-production: SMS errors are downgraded to a warning string. The OTP
 *   is still stored and the request succeeds so dev/test flows are not blocked
 *   by SMS provider configuration issues.
 *
 * @param {string} phoneNumber - Raw phone number (normalized internally).
 * @param {string} otpCode     - Plaintext 4-digit OTP to embed in the SMS.
 * @returns {Promise<string|null>} Warning string if SMS failed non-fatally in dev, else null.
 * @throws {Error} In production if the SMS send fails or any recipient is rejected.
 */
async function sendOtpSms(phoneNumber, otpCode) {
    let warning = null;
    const recipient = normalizePhoneNumber(phoneNumber);
    const senderId = String(process.env.AFRICASTALKING_SENDER_ID || '').trim();

    if (!recipient) {
        throw new Error('Invalid phone number format.');
    }

    if (!isLocalOtpMode()) {
        const options = {
            to: [recipient],
            message: `Your secure access code is: ${otpCode}. Do not share this code with anyone.`
        };

        // Sender ID is optional; without it Africa's Talking uses a shared shortcode.
        if (senderId) {
            options.from = senderId;
        }

        try {
            const smsResponse = await sms.send(options);
            const deliveryFailure = getSmsDeliveryFailure(smsResponse);
            if (deliveryFailure) {
                throw new Error(deliveryFailure);
            }
        } catch (error) {
            const safeMessage = getSafeErrorMessage(error);
            let enrichedMessage = safeMessage;

            // Enrich known Africa's Talking error codes with actionable guidance.
            if (safeMessage.includes('UserInBlacklist')) {
                enrichedMessage = `${safeMessage}. Check Africa's Talking SMS sender/product configuration and recipient opt-out status.`;
            }

            if (safeMessage.includes('InvalidSenderId')) {
                enrichedMessage = `${safeMessage}. Set AFRICASTALKING_SENDER_ID to an approved sender ID.`;
            }

            if (process.env.NODE_ENV === 'production') {
                throw new Error(enrichedMessage);
            }

            // Non-production: log and downgrade to a warning so the OTP flow is
            // not blocked by SMS config issues during development or testing.
            warning = `SMS send failed in non-production mode: ${enrichedMessage}`;
            console.warn('SMS Warning:', warning);
        }
    }

    return warning;
}

/**
 * buildOtpResponse
 * ----------------
 * Builds a consistent OTP API response payload used by all OTP-issuing endpoints.
 * Conditionally includes warning (if SMS failed non-fatally) and developmentOtp
 * (if in local OTP bypass mode) so the frontend and testers can access the code
 * without checking an SMS simulator.
 *
 * @param {object} params
 * @param {string} params.otpCode    - Plaintext OTP (only exposed in dev mode).
 * @param {string|null} params.warning    - Non-fatal SMS warning, or null.
 * @param {string} params.authStage  - AUTH_STAGES value for the frontend to branch on.
 * @param {string} params.authIntent - AUTH_INTENTS value echoed back for context.
 * @param {string} params.message    - Human-readable success message.
 * @returns {object} Response payload object.
 */
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

/**
 * buildDefaultSurvivorProfileFields
 * ----------------------------------
 * Creates deterministic placeholder values for mandatory SurvivorProfile fields
 * when signup collects only phone, password, and OTP. These defaults ensure the
 * profile row can always be created; the survivor can update them later.
 *
 * @param {UserAccount} user - The newly created UserAccount (userId used for nickname).
 * @returns {object} Default profile field values.
 */
function buildDefaultSurvivorProfileFields(user) {
    const shortId = String(user.userId || '').replace(/-/g, '').slice(0, 6) || 'new';
    return {
        displayNickname: `Survivor-${shortId}`,
        assignedGender: 'UNSPECIFIED',
        residenceCounty: 'UNSPECIFIED',
        privacyPreferencesJson: { notificationsEnabled: true }
    };
}

/**
 * sanitizeSignupSurvivorProfileInput
 * ------------------------------------
 * Validates and sanitizes the optional profileDetails object submitted during
 * OTP verification on signup. Merges caller-supplied values over safe defaults,
 * enforcing field-level constraints (max lengths, ENUM safety, boolean coercion).
 *
 * Called only on the first-time SIGNUP_OTP verification path.
 *
 * @param {object|null} rawInput - profileDetails from the verify-otp request body.
 * @param {UserAccount} user     - The UserAccount being signed up (used for fallback nickname).
 * @returns {object} Sanitized profile fields safe to pass to SurvivorProfile.create().
 */
function sanitizeSignupSurvivorProfileInput(rawInput, user) {
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};

    const fallbackNickname = `Survivor-${String(user.userId || '').replace(/-/g, '').slice(0, 6) || 'new'}`;
    const displayNickname = String(input.displayNickname || '').trim();
    const assignedGender = String(input.assignedGender || '').trim().toUpperCase();
    const residenceCounty = String(input.residenceCounty || '').trim();
    const notificationsEnabled = input.notificationsEnabled !== false;

    return {
        displayNickname: (displayNickname || fallbackNickname).slice(0, 50),
        assignedGender: assignedGender || 'UNSPECIFIED',
        residenceCounty: (residenceCounty || 'UNSPECIFIED').slice(0, 50),
        privacyPreferencesJson: { notificationsEnabled }
    };
}

/**
 * pickLeastLoadedStaff
 * --------------------
 * Selects the staff member with the lowest currentWorkloadScore for auto-assignment
 * to a new survivor.
 *
 * Preference order:
 * 1. Staff currently AVAILABLE or BUSY (i.e. online and reachable).
 * 2. If no preferred staff are found, falls back to any staff member regardless
 *    of availability status — ensures assignment always succeeds even when all
 *    staff are OFFLINE.
 *
 * Tie-breaking: ascending primary key ensures deterministic selection when scores
 * are equal, preventing random assignment drift.
 *
 * @param {Model}  ProfileModel - Sequelize model (CounsellorProfile or LegalCounselProfile).
 * @param {string} idField      - The PK field name for that profile ('counsellorId' / 'legalCounselId').
 * @param {Transaction} transaction - Active Sequelize transaction.
 * @returns {Promise<Model|null>} The selected staff profile instance, or null if none exist.
 */
async function pickLeastLoadedStaff(ProfileModel, idField, transaction) {
    // Suspending/banning a staff member only flips UserAccount.accountStatus — their
    // profile's availabilityStatus is left untouched, so an active-account join is
    // required here to avoid auto-assigning new survivors to staff who can't work.
    const activeAccountInclude = {
        model: UserAccount,
        attributes: [],
        where: { accountStatus: 'ACTIVE' },
        required: true
    };

    const preferred = await ProfileModel.findOne({
        where: { availabilityStatus: { [Op.in]: ['AVAILABLE', 'BUSY'] } },
        include: [activeAccountInclude],
        order: [
            ['currentWorkloadScore', 'ASC'],
            [idField, 'ASC']
        ],
        transaction
    });

    if (preferred) return preferred;

    return ProfileModel.findOne({
        include: [activeAccountInclude],
        order: [
            ['currentWorkloadScore', 'ASC'],
            [idField, 'ASC']
        ],
        transaction
    });
}

/**
 * ensureSurvivorStaffAutoAssignment
 * ----------------------------------
 * Idempotently creates a SurvivorProfile for a newly verified survivor and
 * auto-assigns the least-loaded counsellor and legal counsel.
 *
 * All writes happen inside a single Sequelize transaction so a partial failure
 * (e.g. workload score update fails) rolls back the entire assignment rather
 * than leaving the system in an inconsistent state.
 *
 * Side effects (all within the transaction):
 * 1. Creates SurvivorProfile with sanitized profile fields and assignment FKs.
 * 2. Increments currentWorkloadScore on both assigned staff profiles.
 * 3. Writes a StaffAssignmentHistory record for audit purposes.
 *
 * Idempotent: if a SurvivorProfile already exists for this userId (e.g. due to
 * a duplicate request), it is returned as-is without re-assigning staff.
 *
 * @param {UserAccount} user              - The verified UserAccount.
 * @param {object|null} profileOverrides  - Sanitized profile fields from signup form (may be null).
 * @returns {Promise<SurvivorProfile>} The created (or existing) SurvivorProfile instance.
 */
async function ensureSurvivorStaffAutoAssignment(user, profileOverrides = null) {
    return sequelize.transaction(async (transaction) => {
        const existingProfile = await SurvivorProfile.findOne({
            where: { userId: user.userId },
            transaction
        });

        if (existingProfile) {
            return existingProfile;
        }

        const assignedCounsellor = await pickLeastLoadedStaff(CounsellorProfile, 'counsellorId', transaction);
        const assignedLegalCounsel = await pickLeastLoadedStaff(LegalCounselProfile, 'legalCounselId', transaction);
        const defaults = buildDefaultSurvivorProfileFields(user);
        const profileData = profileOverrides && typeof profileOverrides === 'object'
            ? { ...defaults, ...profileOverrides }
            : defaults;

        const survivorProfile = await SurvivorProfile.create({
            survivorId: randomUUID(),
            userId: user.userId,
            ...profileData,
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

// ---------------------------------------------------------------------------
// Route handlers (exported)
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/request-otp
 * --------------------------
 * Entry point for OTP-based signup phone verification — the first step of the
 * signup flow (phone → OTP verify → password + profile details). Signin no
 * longer has a standalone OTP path; OTP there is sent automatically as a 2FA
 * step after a successful password check (see loginWithPassword/verify2FA).
 *
 * Signup path (SIGNUP_OTP, the only intent this endpoint accepts):
 * - If no account exists for the phone, a shell UserAccount is created
 *   immediately (role: SURVIVOR, status: ACTIVE, no password yet).
 * - If an account already has a password, returns 409 SIGNIN_REQUIRED.
 *
 * - Checks for an active lockout before generating a new OTP.
 * - Generates a 4-digit OTP, bcrypt-hashes it, and stores it with purpose + expiry.
 * - Sends the plaintext OTP via SMS (or exposes it in response body in dev mode).
 * - Returns authStage: OTP_VERIFICATION_REQUIRED so the frontend shows the OTP input.
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, authIntent? }
 * @param {import('express').Response} res
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

        if (user?.hashedPassword) {
            return res.status(409).json({
                error: 'Account already has a password. Please sign in instead.',
                authStage: AUTH_STAGES.SIGNIN_REQUIRED
            });
        }

        if (!user) {
            // No account exists — create a shell account for the signup flow.
            // Role is always SURVIVOR here; staff accounts are provisioned by NGO admins.
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

        const otpCode = String(randomInt(1000, 10000));
        const effectiveIntent = resolvedIntent || AUTH_INTENTS.SIGNUP_OTP;

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
 * -------------------------
 * Second step of the signup flow: phone → OTP verify (this step) → details.
 * Validates the submitted SIGNUP_OTP and, on success, issues a short-lived
 * signup ticket instead of a JWT — the account isn't complete yet, since
 * password + profile details are still to come in complete-signup.
 *
 * - Auto-lifts expired temporary bans before any access check.
 * - Rejects BANNED / SUSPENDED / DEACTIVATED accounts (with reason for BANNED).
 * - Enforces lockout: rejects if authLockUntil is still in the future.
 * - Validates OTP purpose is SIGNUP_OTP (cross-flow replay prevention) and expiry.
 * - bcrypt.compares the submitted OTP against the stored hash.
 * - On failure: increments attempt counter; locks and voids OTP at exhaustion.
 * - On success: clears the OTP, sets isOtpVerified, and stores a fresh bcrypt-hashed
 *   signup ticket (purpose SIGNUP_TICKET) reusing the same OTP storage fields —
 *   the plaintext ticket is returned once in the response and must be echoed back
 *   to complete-signup.
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, otp }
 * @param {import('express').Response} res
 */
const verifyOTP = async (req, res) => {
    const { phoneNumber, otp } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        // Lift a time-limited ban whose expiry has passed before evaluating access.
        await liftExpiredBan(user);

        if (!isAccountActive(user)) {
            const isBanned = String(user.accountStatus).toUpperCase() === 'BANNED';
            return res.status(403).json({
                error: isBanned
                    ? 'This account has been suspended from the platform.'
                    : 'This account is suspended or deactivated.',
                ...(isBanned && user.banReason ? { reason: user.banReason } : {}),
                ...(isBanned && user.banExpiresAt ? { expiresAt: user.banExpiresAt } : {})
            });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        if (user.hashedPassword) {
            return res.status(409).json({
                error: 'This account already has a password. Please sign in instead.',
                authStage: AUTH_STAGES.SIGNIN_REQUIRED
            });
        }

        // OTP must match both value and purpose to prevent cross-flow replay.
        if (!user.otpHash || user.otpPurpose !== AUTH_INTENTS.SIGNUP_OTP) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'OTP has expired. Request a new code.' });
        }

        const otpMatches = await bcrypt.compare(String(otp), user.otpHash);
        if (!otpMatches) {
            const failure = await registerOtpFailure(user);
            if (failure.exhausted) {
                return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
            }

            return res.status(401).json({ error: 'Invalid OTP.' });
        }

        user.isOtpVerified = true;
        user.authLockUntil = null;
        user.authFailedAttempts = 0;
        await user.save();

        // Issue a one-time signup ticket so the details step doesn't need the OTP again.
        const signupTicket = randomUUID();
        await setOtpForUser(user, signupTicket, AUTH_INTENTS.SIGNUP_TICKET);

        return res.status(200).json({
            message: 'Phone number verified. Continue to set your password and profile details.',
            authStage: AUTH_STAGES.DETAILS_REQUIRED,
            authIntent: AUTH_INTENTS.SIGNUP_OTP,
            signupTicket
        });
    } catch (error) {
        console.error('Verification Error:', error);
        return res.status(500).json({ error: 'Server error during verification.' });
    }
};

/**
 * POST /api/auth/complete-signup
 * -------------------------------
 * Third and final step of the signup flow: phone → OTP verify → details (this
 * step). Validates the signup ticket issued by verify-otp, sets the password,
 * creates the survivor profile + staff auto-assignment, and issues a JWT.
 *
 * - Validates the ticket purpose is SIGNUP_TICKET (cross-flow replay prevention) and expiry.
 * - bcrypt.compares the submitted ticket against the stored hash.
 * - On failure: increments the same attempt counter used by OTP verification;
 *   locks and voids the ticket at exhaustion.
 * - On success:
 *   1. Hashes and stores the password.
 *   2. Calls ensureSurvivorStaffAutoAssignment to create the SurvivorProfile,
 *      auto-assign counsellor and legal counsel, and write the assignment history
 *      record — all in a single transaction.
 *   3. Calls ensureAutoChannelsForSurvivor to eagerly provision direct chat
 *      channels to both assigned staff so they are immediately visible.
 *   4. Clears ticket state and issues a 2-hour JWT.
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, signupTicket, password, profileDetails? }
 * @param {import('express').Response} res
 */
const completeSignup = async (req, res) => {
    const { phoneNumber, signupTicket, password, profileDetails } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password is required and must be at least 8 characters.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired signup ticket.' });
        }

        await liftExpiredBan(user);

        if (!isAccountActive(user)) {
            return res.status(403).json({ error: 'This account is suspended or deactivated.' });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        if (user.hashedPassword) {
            return res.status(409).json({
                error: 'This account already has a password. Please sign in instead.',
                authStage: AUTH_STAGES.SIGNIN_REQUIRED
            });
        }

        if (!user.isOtpVerified || !user.otpHash || user.otpPurpose !== AUTH_INTENTS.SIGNUP_TICKET) {
            return res.status(401).json({ error: 'Invalid or expired signup ticket. Please verify your phone number again.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'Signup ticket has expired. Please verify your phone number again.' });
        }

        const ticketMatches = await bcrypt.compare(String(signupTicket || ''), user.otpHash);
        if (!ticketMatches) {
            const failure = await registerOtpFailure(user);
            if (failure.exhausted) {
                return res.status(429).json({ error: 'Too many invalid attempts. Please verify your phone number again.' });
            }

            return res.status(401).json({ error: 'Invalid signup ticket.' });
        }

        user.hashedPassword = await bcrypt.hash(password, 10);
        await clearOtpForUser(user); // also calls user.save()

        // Signup completion bundles three side effects:
        // 1) sanitize/persist survivor profile fields from the onboarding UI
        // 2) auto-assign least-loaded counsellor and legal counsel
        // 3) pre-create direct chat channels for immediate visibility on the chat page
        const sanitizedProfileInput = sanitizeSignupSurvivorProfileInput(profileDetails, user);
        const survivorProfile = await ensureSurvivorStaffAutoAssignment(user, sanitizedProfileInput);
        await ensureAutoChannelsForSurvivor(survivorProfile);

        const token = issueAuthToken(user);

        return res.status(200).json({
            message: 'Signup complete!',
            token,
            userId: user.userId,
            authStage: AUTH_STAGES.AUTHENTICATED,
            authMethod: 'SIGNUP',
            role: getCanonicalRole(user)
        });
    } catch (error) {
        console.error('Complete Signup Error:', error);
        return res.status(500).json({ error: 'Server error while completing signup.' });
    }
};

/**
 * POST /api/auth/login-password
 * -----------------------------
 * Primary signin entry point: phone + password, with OTP as a mandatory 2FA
 * step rather than a separate alternative login method. A successful password
 * match does NOT issue a JWT directly — it sends a SIGNIN_2FA OTP and returns
 * authStage: OTP_2FA_REQUIRED; the frontend must then call verify-2fa.
 *
 * Flow:
 * - Normalizes phone number and fetches the account.
 * - Returns a generic 401 (no account vs wrong password are indistinguishable)
 *   to prevent account enumeration.
 * - Auto-lifts any expired temporary ban.
 * - Rejects BANNED / SUSPENDED / DEACTIVATED accounts.
 * - Rejects accounts under an active lockout (returns seconds remaining).
 * - bcrypt.compare against hashedPassword.
 * - On failure: calls registerPasswordFailure (increments counter, locks at threshold).
 * - On success: calls clearPasswordFailureState, then either:
 *   - if account.status === 'password_reset_required': issues the JWT immediately
 *     with authStage PASSWORD_RESET_REQUIRED (the staff member must set a real
 *     password before normal navigation anyway, so 2FA is deferred to their next login), or
 *   - otherwise: sends a SIGNIN_2FA OTP and returns authStage OTP_2FA_REQUIRED (no token yet).
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, password }
 * @param {import('express').Response} res
 */
const loginWithPassword = async (req, res) => {
    const { phoneNumber, password } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!normalizedPhone || !password) {
            return res.status(400).json({ error: 'Phone number and password are required.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });

        // Generic rejection: do not distinguish "no account" from "wrong password"
        // to prevent callers from enumerating which phone numbers are registered.
        if (!user || !user.hashedPassword) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        // Lift a time-limited ban whose expiry has passed before evaluating access.
        await liftExpiredBan(user);

        if (!isAccountActive(user)) {
            const isBanned = String(user.accountStatus).toUpperCase() === 'BANNED';
            return res.status(403).json({
                error: isBanned
                    ? 'This account has been suspended from the platform.'
                    : 'This account is suspended or deactivated.',
                ...(isBanned && user.banReason ? { reason: user.banReason } : {}),
                ...(isBanned && user.banExpiresAt ? { expiresAt: user.banExpiresAt } : {})
            });
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

        if (String(user.status || '').toLowerCase() === 'password_reset_required') {
            const token = issueAuthToken(user);
            return res.status(200).json({
                message: 'Password reset is required before first access.',
                token,
                userId: user.userId,
                authStage: AUTH_STAGES.PASSWORD_RESET_REQUIRED,
                authMethod: 'PASSWORD',
                role: getCanonicalRole(user)
            });
        }

        const otpCode = String(randomInt(1000, 10000));
        await setOtpForUser(user, otpCode, AUTH_INTENTS.SIGNIN_2FA);
        const warning = await sendOtpSms(phoneNumber, otpCode);

        return res.status(200).json(buildOtpResponse({
            otpCode,
            warning,
            authStage: AUTH_STAGES.OTP_2FA_REQUIRED,
            authIntent: AUTH_INTENTS.SIGNIN_2FA,
            message: 'Password verified. Enter the OTP sent to your phone to finish signing in.'
        }));
    } catch (error) {
        console.error('Password Login Error:', error);
        return res.status(500).json({ error: 'Server error during password login.' });
    }
};

/**
 * POST /api/auth/verify-2fa
 * --------------------------
 * Second factor for signin: validates the SIGNIN_2FA OTP sent by
 * loginWithPassword and, on success, issues the JWT that login-password
 * deferred.
 *
 * - Auto-lifts expired temporary bans before any access check.
 * - Rejects BANNED / SUSPENDED / DEACTIVATED accounts (with reason for BANNED).
 * - Enforces lockout: rejects if authLockUntil is still in the future.
 * - Validates OTP purpose is SIGNIN_2FA (cross-flow replay prevention) and expiry.
 * - bcrypt.compares the submitted OTP against the stored hash.
 * - On failure: increments attempt counter; locks and voids OTP at exhaustion.
 * - On success: clears OTP state, issues a 2-hour JWT.
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, otp }
 * @param {import('express').Response} res
 */
const verify2FA = async (req, res) => {
    const { phoneNumber, otp } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });
        if (!user || !user.hashedPassword) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        await liftExpiredBan(user);

        if (!isAccountActive(user)) {
            const isBanned = String(user.accountStatus).toUpperCase() === 'BANNED';
            return res.status(403).json({
                error: isBanned
                    ? 'This account has been suspended from the platform.'
                    : 'This account is suspended or deactivated.',
                ...(isBanned && user.banReason ? { reason: user.banReason } : {}),
                ...(isBanned && user.banExpiresAt ? { expiresAt: user.banExpiresAt } : {})
            });
        }

        if (isLocked(user)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to repeated failed attempts.',
                retryAfterSeconds: getLockoutSecondsRemaining(user)
            });
        }

        if (!user.otpHash || user.otpPurpose !== AUTH_INTENTS.SIGNIN_2FA) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'OTP has expired. Please sign in again.' });
        }

        const otpMatches = await bcrypt.compare(String(otp), user.otpHash);
        if (!otpMatches) {
            const failure = await registerOtpFailure(user);
            if (failure.exhausted) {
                return res.status(429).json({ error: 'Too many invalid OTP attempts. Please sign in again.' });
            }

            return res.status(401).json({ error: 'Invalid OTP.' });
        }

        user.isOtpVerified = true;
        user.authLockUntil = null;
        user.authFailedAttempts = 0;
        await clearOtpForUser(user); // also calls user.save()

        const token = issueAuthToken(user);

        return res.status(200).json({
            message: 'Login successful!',
            token,
            userId: user.userId,
            authStage: AUTH_STAGES.AUTHENTICATED,
            authMethod: 'PASSWORD_2FA',
            role: getCanonicalRole(user)
        });
    } catch (error) {
        console.error('2FA Verification Error:', error);
        return res.status(500).json({ error: 'Server error during 2FA verification.' });
    }
};

/**
 * POST /api/auth/forgot-password/request
 * ----------------------------------------
 * Initiates the forgot-password flow by sending a PASSWORD_RESET OTP to the
 * account's registered phone number.
 *
 * Response shape is intentionally generic regardless of whether the phone number
 * is registered: always HTTP 200 with the same message. This prevents account
 * enumeration — a caller cannot determine whether a phone number has an account.
 *
 * If the account does not exist or has no hashedPassword (incomplete signup),
 * the response is identical to a success but no OTP is generated or sent.
 *
 * @param {import('express').Request}  req - Body: { phoneNumber }
 * @param {import('express').Response} res
 */
const requestPasswordReset = async (req, res) => {
    const { phoneNumber } = req.body;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    try {
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Phone number is required.' });
        }

        const user = await UserAccount.findOne({ where: { phoneNumber: normalizedPhone } });

        // Return a generic success response even when no account exists —
        // prevents enumeration of registered phone numbers.
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

        const otpCode = String(randomInt(1000, 10000));
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
 * --------------------------------------
 * Second step of the forgot-password flow. Validates the PASSWORD_RESET OTP
 * and writes the new hashed password to the account.
 *
 * On success:
 * - The new password is bcrypt-hashed and saved.
 * - All failure counters and lockout state are cleared.
 * - OTP state is cleared so the code cannot be replayed.
 * - Returns HTTP 200 with a success message (no token; user must sign in again).
 *
 * @param {import('express').Request}  req - Body: { phoneNumber, otp, newPassword }
 * @param {import('express').Response} res
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

        // OTP must exist and must have been issued for the PASSWORD_RESET flow specifically.
        if (!user.otpHash || user.otpPurpose !== AUTH_INTENTS.PASSWORD_RESET) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() <= Date.now()) {
            await clearOtpForUser(user);
            return res.status(401).json({ error: 'OTP has expired. Request a new code.' });
        }

        const resetOtpMatches = await bcrypt.compare(String(otp), user.otpHash);
        if (!resetOtpMatches) {
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
 * ---------------------------
 * Authenticated endpoint for in-session password changes. Used in two scenarios:
 *
 * 1. Staff first login: an NGO admin creates a staff account with
 *    status='password_reset_required'. On first login, the auth response includes
 *    authStage: PASSWORD_RESET_REQUIRED and the frontend gates all navigation
 *    until this endpoint is called successfully.
 *
 * 2. Any authenticated user choosing to change their password in-session.
 *    For this path, currentPassword is required unless the account is in the
 *    forced-reset state (status='password_reset_required').
 *
 * On success, account status is set to 'active' to clear the forced-reset gate.
 *
 * Requires: valid JWT in the Authorization header (enforced by authMiddleware).
 *
 * @param {import('express').Request}  req - Body: { password, currentPassword? }; req.user populated by authMiddleware.
 * @param {import('express').Response} res
 */
const setPassword = async (req, res) => {
     const { password, currentPassword } = req.body;

    try {
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const user = await UserAccount.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const needsForcedReset = String(user.status || '').toLowerCase() === 'password_reset_required';
        if (!needsForcedReset) {
            if (!currentPassword) {
                return res.status(401).json({ error: 'Current password is required.' });
            }

            const currentPasswordMatches = await bcrypt.compare(String(currentPassword), user.hashedPassword || '');
            if (!currentPasswordMatches) {
                return res.status(401).json({ error: 'Current password is incorrect.' });
            }
        }

        user.hashedPassword = await bcrypt.hash(password, 10);
        // Clear the forced-reset gate so subsequent logins proceed normally.
        user.status = 'active';
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
    completeSignup,
    loginWithPassword,
    verify2FA,
    requestPasswordReset,
    resetPasswordWithOtp,
    setPassword,
    AUTH_STAGES,
    AUTH_INTENTS,
    // Exported for use in authMiddleware and other auth-adjacent flows.
    liftExpiredBan,
    // Exported for reuse by admin/USSD auto-routing (least-loaded-staff suggestion).
    pickLeastLoadedStaff
};
