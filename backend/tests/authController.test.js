/**
 * authController.test.js
 * ----------------------
 * Unit tests for the three-step OTP-first signup flow, mandatory-2FA signin flow,
 * and forgot-password reset flow.
 *
 * Covered:
 * - Signup step 1 (POST /api/auth/request-otp, authIntent=SIGNUP_OTP):
 *     creates account when phone is new; rejects when account already has a password.
 * - Signup step 2 (POST /api/auth/verify-otp):
 *     issues a signup ticket on success; rejects wrong OTP and increments failure counter.
 * - Signup step 3 (POST /api/auth/complete-signup):
 *     validates ticket, hashes password, creates SurvivorProfile, issues JWT.
 * - Signin step 1 (POST /api/auth/login-password):
 *     valid password sends 2FA OTP and returns OTP_2FA_REQUIRED (no token yet);
 *     wrong password returns 401 and increments authFailedAttempts.
 * - Signin step 2 (POST /api/auth/verify-2fa):
 *     valid 2FA OTP issues JWT with authMethod=PASSWORD_2FA.
 * - Forgot-password (POST /api/auth/forgot-password/request + /reset):
 *     non-enumerable response for unknown accounts; successful reset hashes new password.
 *
 * All DB calls, bcrypt, jwt, Africa's Talking SMS, and rate-limit middleware are mocked.
 * No network or database connection is required.
 */

const request = require('supertest');
const express = require('express');

jest.mock('africastalking', () => () => ({
    SMS: {
        send: jest.fn().mockResolvedValue({ SMSMessageData: { Message: 'Sent to 1/1 Total Cost: 0.0000' } })
    }
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn(),
    compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn()
}));

jest.mock('../src/middleware/authRateLimitMiddleware', () => ({
    otpRequestLimiter: (req, res, next) => next(),
    authSensitiveLimiter: (req, res, next) => next()
}));

jest.mock('../src/middleware/authMiddleware', () => (req, res, next) => {
    req.user = { id: 7 };
    next();
});

// A single shared fake transaction so tests can assert on commit/rollback calls.
// Supports both the managed style (sequelize.transaction(callback)), used by
// ensureSurvivorStaffAutoAssignment when called standalone, and the unmanaged
// style (await sequelize.transaction() then commit()/rollback() explicitly),
// used by completeSignup to wrap password + profile + channel provisioning.
const mockSignupTransaction = {
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue()
};

jest.mock('../src/config/database', () => ({
    transaction: jest.fn((callback) => (
        callback ? callback(mockSignupTransaction) : Promise.resolve(mockSignupTransaction)
    ))
}));

jest.mock('../src/models', () => ({
    UserAccount: {
        findOne: jest.fn(),
        create: jest.fn(),
        findByPk: jest.fn()
    },
    SurvivorProfile: {
        findOne: jest.fn(),
        create: jest.fn()
    },
    CounsellorProfile: {
        findOne: jest.fn()
    },
    LegalCounselProfile: {
        findOne: jest.fn()
    },
    StaffAssignmentHistory: {
        create: jest.fn()
    }
}));

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
    UserAccount,
    SurvivorProfile,
    CounsellorProfile,
    LegalCounselProfile,
    StaffAssignmentHistory
} = require('../src/models');
const authRoutes = require('../src/routes/authRoutes');

/**
 * Builds a realistic, mutable UserAccount-like object for controller tests.
 *
 * Why this helper exists:
 * - Controllers mutate model instances in-place (attempt counters, OTP state)
 * - Sequelize instances expose async save(), which we emulate via jest.fn()
 * - Individual tests can override only fields relevant to that flow
 */
function buildUser(overrides = {}) {
    return {
        userId: 7,
        phoneNumber: '+254711000001',
        userRole: 'SURVIVOR',
        role: 'survivor',
        hashedPassword: 'hashed-password',
        isOtpVerified: false,
        otpHash: null,
        otpPurpose: null,
        otpExpiresAt: null,
        otpAttemptCount: 0,
        authFailedAttempts: 0,
        authLockUntil: null,
        save: jest.fn().mockResolvedValue(),
        ...overrides
    };
}

describe('Auth Controller', () => {
    let app;

    beforeAll(() => {
        // Test env is deterministic: no real SMS and stable JWT signing behavior.
        process.env.JWT_SECRET = 'test-secret';
        process.env.NODE_ENV = 'test';
        process.env.SKIP_SMS_IN_DEV = 'true';
    });

    beforeEach(() => {
        jest.clearAllMocks();

        app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);

        bcrypt.hash.mockResolvedValue('new-hashed-password');
        bcrypt.compare.mockResolvedValue(true);
        jwt.sign.mockReturnValue('mock-jwt-token');

        SurvivorProfile.findOne.mockResolvedValue(null);
        SurvivorProfile.create.mockResolvedValue({ survivorId: 'survivor-test-id' });
        StaffAssignmentHistory.create.mockResolvedValue();

        CounsellorProfile.findOne.mockResolvedValue({
            counsellorId: 'counsellor-1',
            currentWorkloadScore: 1,
            save: jest.fn().mockResolvedValue()
        });

        LegalCounselProfile.findOne.mockResolvedValue({
            legalCounselId: 'legal-1',
            currentWorkloadScore: 2,
            save: jest.fn().mockResolvedValue()
        });
    });

    // Signup bootstrap path: the endpoint should create a UserAccount when the phone is unrecognised.
    test('creates a pending account and returns OTP_VERIFICATION_REQUIRED for a new phone number', async () => {
        const createdUser = buildUser({
            hashedPassword: null,
            otpHash: null,
            save: jest.fn().mockResolvedValue()
        });

        UserAccount.findOne.mockResolvedValue(null);
        UserAccount.create.mockResolvedValue(createdUser);

        const response = await request(app)
            .post('/api/auth/request-otp')
            .send({ phoneNumber: '0711000001', authIntent: 'SIGNUP_OTP' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('OTP_VERIFICATION_REQUIRED');
        expect(response.body.authIntent).toBe('SIGNUP_OTP');
        expect(response.body.developmentOtp).toHaveLength(4);
        expect(UserAccount.create).toHaveBeenCalled();
    });

    test('returns 409 SIGNIN_REQUIRED when the phone number already has a completed account', async () => {
        UserAccount.findOne.mockResolvedValue(buildUser({ hashedPassword: 'existing-hash' }));

        const response = await request(app)
            .post('/api/auth/request-otp')
            .send({ phoneNumber: '+254711000999', authIntent: 'SIGNUP_OTP' });

        expect(response.status).toBe(409);
        expect(response.body.authStage).toBe('SIGNIN_REQUIRED');
    });

    // Verifying the signup OTP issues a one-time signup ticket — no password is set yet.
    test('returns a signup ticket and DETAILS_REQUIRED when the signup OTP is correct', async () => {
        const user = buildUser({
            hashedPassword: null,
            otpHash: '1234',
            otpPurpose: 'SIGNUP_OTP',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/verify-otp')
            .send({ phoneNumber: '+254711000001', otp: '1234' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('DETAILS_REQUIRED');
        expect(response.body.signupTicket).toBeTruthy();
        expect(user.isOtpVerified).toBe(true);
    });

    // End-to-end signup success: ticket is consumed, password hashed, SurvivorProfile created, JWT issued.
    test('issues a JWT with authMethod=SIGNUP when the ticket and password are valid', async () => {
        const user = buildUser({
            hashedPassword: null,
            isOtpVerified: true,
            otpHash: 'hashed-ticket',
            otpPurpose: 'SIGNUP_TICKET',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/complete-signup')
            .send({
                phoneNumber: '+254711000001',
                signupTicket: 'some-ticket',
                password: 'StrongPass!123'
            });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('AUTHENTICATED');
        expect(response.body.authMethod).toBe('SIGNUP');
        expect(response.body.token).toBe('mock-jwt-token');
        expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass!123', 10);
        expect(SurvivorProfile.create).toHaveBeenCalled();
        expect(StaffAssignmentHistory.create).toHaveBeenCalled();
    });

    // Wrong OTP must not authenticate and must increment the per-account OTP failure counter.
    test('returns 401 and increments otpAttemptCount when the submitted OTP does not match', async () => {
        const user = buildUser({
            hashedPassword: null,
            otpHash: 'bcrypt-hash-of-1234', // stored as bcrypt hash
            otpPurpose: 'SIGNUP_OTP',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            otpAttemptCount: 0
        });

        UserAccount.findOne.mockResolvedValue(user);
        // OTP comparison now uses bcrypt.compare — override the beforeEach default (true)
        // to simulate a wrong OTP being submitted.
        bcrypt.compare.mockResolvedValueOnce(false);

        const response = await request(app)
            .post('/api/auth/verify-otp')
            .send({ phoneNumber: '+254711000001', otp: '9999' });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid OTP.');
        expect(user.save).toHaveBeenCalled();
    });

    // Password flow happy path: matching the password must NOT issue a JWT — it defers to 2FA.
    test('sends a SIGNIN_2FA OTP and returns OTP_2FA_REQUIRED without a token when the password is correct', async () => {
        const user = buildUser({ hashedPassword: 'stored-hash' });

        UserAccount.findOne.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/auth/login-password')
            .send({ phoneNumber: '+254711000001', password: 'StrongPass!123' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('OTP_2FA_REQUIRED');
        expect(response.body.authIntent).toBe('SIGNIN_2FA');
        expect(response.body.token).toBeUndefined();
    });

    // Second factor: a valid 2FA OTP is the only path that produces a JWT for normal sign-in.
    test('issues a JWT with authMethod=PASSWORD_2FA when the 2FA OTP is correct', async () => {
        const user = buildUser({
            hashedPassword: 'stored-hash',
            otpHash: 'bcrypt-hash-of-1234',
            otpPurpose: 'SIGNIN_2FA',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/auth/verify-2fa')
            .send({ phoneNumber: '+254711000001', otp: '1234' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('AUTHENTICATED');
        expect(response.body.authMethod).toBe('PASSWORD_2FA');
        expect(response.body.token).toBe('mock-jwt-token');
    });

    // Password mismatch must return a generic error to avoid disclosing account existence.
    test('returns 401 and increments authFailedAttempts when the password does not match', async () => {
        const user = buildUser({ hashedPassword: 'stored-hash', authFailedAttempts: 0 });

        UserAccount.findOne.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(false);

        const response = await request(app)
            .post('/api/auth/login-password')
            .send({ phoneNumber: '+254711000001', password: 'WrongPass!1' });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid credentials.');
        expect(user.save).toHaveBeenCalled();
    });

    // The forgot-password endpoint must respond identically for known and unknown accounts to prevent enumeration.
    test('returns PASSWORD_RESET_OTP_REQUIRED for an unrecognised phone number (no enumeration leak)', async () => {
        UserAccount.findOne.mockResolvedValue(null);

        const response = await request(app)
            .post('/api/auth/forgot-password/request')
            .send({ phoneNumber: '+254700000000' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('PASSWORD_RESET_OTP_REQUIRED');
        expect(response.body.authIntent).toBe('PASSWORD_RESET');
    });

    // Reset flow must validate the OTP purpose, compare the code, and atomically replace the stored password hash.
    test('hashes the new password and persists it when a valid PASSWORD_RESET OTP is provided', async () => {
        const user = buildUser({
            hashedPassword: 'old-hash',
            otpHash: '5555',
            otpPurpose: 'PASSWORD_RESET',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/forgot-password/reset')
            .send({
                phoneNumber: '+254711000001',
                otp: '5555',
                newPassword: 'NewStrongPass!123'
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Password reset successful.');
        expect(bcrypt.hash).toHaveBeenCalledWith('NewStrongPass!123', 10);
        expect(user.save).toHaveBeenCalled();
    });

    // Bug fix: resetPasswordWithOtp previously skipped the lockout check every
    // other OTP-verification entry point enforces, letting a locked-out account
    // still have reset OTPs brute-forced against it.
    test('returns 423 and skips OTP comparison when the account is locked out', async () => {
        const user = buildUser({
            hashedPassword: 'old-hash',
            otpHash: '5555',
            otpPurpose: 'PASSWORD_RESET',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            authLockUntil: new Date(Date.now() + 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/forgot-password/reset')
            .send({
                phoneNumber: '+254711000001',
                otp: '5555',
                newPassword: 'NewStrongPass!123'
            });

        expect(response.status).toBe(423);
        expect(response.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    test('returns 403 and skips OTP comparison when the account is suspended/banned', async () => {
        const user = buildUser({
            hashedPassword: 'old-hash',
            otpHash: '5555',
            otpPurpose: 'PASSWORD_RESET',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            accountStatus: 'SUSPENDED'
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/forgot-password/reset')
            .send({
                phoneNumber: '+254711000001',
                otp: '5555',
                newPassword: 'NewStrongPass!123'
            });

        expect(response.status).toBe(403);
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    // Bug fix: completeSignup now wraps the password write, profile creation, and
    // channel provisioning in one transaction, so a failure partway through rolls
    // back instead of stranding a password-set account with no SurvivorProfile.
    test('rolls back the signup transaction (not committed) when profile creation fails', async () => {
        const user = buildUser({
            hashedPassword: null,
            isOtpVerified: true,
            otpHash: 'hashed-ticket',
            otpPurpose: 'SIGNUP_TICKET',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);
        SurvivorProfile.create.mockRejectedValue(new Error('DB write failed'));

        const response = await request(app)
            .post('/api/auth/complete-signup')
            .send({
                phoneNumber: '+254711000001',
                signupTicket: 'some-ticket',
                password: 'StrongPass!123'
            });

        expect(response.status).toBe(500);
        expect(mockSignupTransaction.rollback).toHaveBeenCalled();
        expect(mockSignupTransaction.commit).not.toHaveBeenCalled();
    });

    test('set-password requires currentPassword for non-forced-reset accounts', async () => {
        const user = buildUser({
            status: 'active',
            hashedPassword: 'stored-hash'
        });
        UserAccount.findByPk.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/set-password')
            .send({ password: 'NewStrongPass!123' });

        expect(response.status).toBe(401);
        expect(response.body.error).toMatch(/current password is required/i);
    });

    test('set-password rejects wrong currentPassword for non-forced-reset accounts', async () => {
        const user = buildUser({
            status: 'active',
            hashedPassword: 'stored-hash'
        });
        UserAccount.findByPk.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValueOnce(false);

        const response = await request(app)
            .post('/api/auth/set-password')
            .send({ password: 'NewStrongPass!123', currentPassword: 'WrongPass!123' });

        expect(response.status).toBe(401);
        expect(response.body.error).toMatch(/current password is incorrect/i);
    });

    test('set-password accepts correct currentPassword for non-forced-reset accounts', async () => {
        const user = buildUser({
            status: 'active',
            hashedPassword: 'stored-hash'
        });
        UserAccount.findByPk.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValueOnce(true);

        const response = await request(app)
            .post('/api/auth/set-password')
            .send({ password: 'NewStrongPass!123', currentPassword: 'CurrentPass!123' });

        expect(response.status).toBe(200);
        expect(response.body.message).toMatch(/password set successfully/i);
        expect(bcrypt.hash).toHaveBeenCalledWith('NewStrongPass!123', 10);
    });

    test('set-password allows forced-reset flow without currentPassword', async () => {
        const user = buildUser({
            status: 'password_reset_required',
            hashedPassword: 'stored-hash'
        });
        UserAccount.findByPk.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/set-password')
            .send({ password: 'NewStrongPass!123' });

        expect(response.status).toBe(200);
        expect(response.body.message).toMatch(/password set successfully/i);
        expect(user.status).toBe('active');
    });
});
