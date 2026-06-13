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

jest.mock('../src/config/database', () => ({
    transaction: jest.fn(async (callback) => callback({}))
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

    // Signup bootstrap path: request OTP should create survivor account when absent.
    test('requests signup OTP for a new account', async () => {
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

    test('blocks OTP sign-in when account is not completed', async () => {
        UserAccount.findOne.mockResolvedValue(null);

        const response = await request(app)
            .post('/api/auth/request-otp')
            .send({ phoneNumber: '+254711000999', authIntent: 'SIGNIN_OTP' });

        expect(response.status).toBe(409);
        expect(response.body.authStage).toBe('SIGNUP_REQUIRED');
        expect(response.body.suggestedAuthIntent).toBe('SIGNUP_OTP');
    });

    // First-time signup must stop at PASSWORD_SETUP_REQUIRED when password omitted.
    test('requires password setup after signup OTP verification when password missing', async () => {
        const user = buildUser({
            hashedPassword: null,
            otpHash: '1234',
            otpPurpose: 'SIGNUP_OTP',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/verify-otp')
            .send({ phoneNumber: '+254711000001', otp: '1234', authIntent: 'SIGNUP_OTP' });

        expect(response.status).toBe(400);
        expect(response.body.authStage).toBe('PASSWORD_SETUP_REQUIRED');
        expect(response.body.authIntent).toBe('SIGNUP_OTP');
    });

    // End-to-end OTP signup success: verifies OTP, hashes password, issues token.
    test('completes signup after OTP verification with a valid password', async () => {
        const user = buildUser({
            hashedPassword: null,
            otpHash: '1234',
            otpPurpose: 'SIGNUP_OTP',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        UserAccount.findOne.mockResolvedValue(user);

        const response = await request(app)
            .post('/api/auth/verify-otp')
            .send({
                phoneNumber: '+254711000001',
                otp: '1234',
                authIntent: 'SIGNUP_OTP',
                password: 'StrongPass!123'
            });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('AUTHENTICATED');
        expect(response.body.authMethod).toBe('OTP');
        expect(response.body.token).toBe('mock-jwt-token');
        expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass!123', 10);
        expect(SurvivorProfile.create).toHaveBeenCalled();
        expect(StaffAssignmentHistory.create).toHaveBeenCalled();
    });

    // Wrong OTP should not authenticate and must increment per-account OTP failure state.
    test('rejects invalid OTP during sign-in and records failure', async () => {
        const user = buildUser({
            otpHash: 'bcrypt-hash-of-1234', // stored as bcrypt hash
            otpPurpose: 'SIGNIN_OTP',
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            otpAttemptCount: 0
        });

        UserAccount.findOne.mockResolvedValue(user);
        // OTP comparison now uses bcrypt.compare — override the beforeEach default (true)
        // to simulate a wrong OTP being submitted.
        bcrypt.compare.mockResolvedValueOnce(false);

        const response = await request(app)
            .post('/api/auth/verify-otp')
            .send({ phoneNumber: '+254711000001', otp: '9999', authIntent: 'SIGNIN_OTP' });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid OTP.');
        expect(user.save).toHaveBeenCalled();
    });

    // Password flow happy path for existing users with hashed credentials.
    test('logs in with password when credentials are valid', async () => {
        const user = buildUser({ hashedPassword: 'stored-hash' });

        UserAccount.findOne.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/auth/login-password')
            .send({ phoneNumber: '+254711000001', password: 'StrongPass!123' });

        expect(response.status).toBe(200);
        expect(response.body.authMethod).toBe('PASSWORD');
        expect(response.body.authStage).toBe('AUTHENTICATED');
        expect(response.body.token).toBe('mock-jwt-token');
    });

    // Password mismatch is expected to return generic auth failure and persist attempt state.
    test('rejects password login on mismatch and increments failure state', async () => {
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

    // Forgot-password endpoint intentionally avoids account-enumeration leaks.
    test('returns generic forgot-password response for unknown accounts', async () => {
        UserAccount.findOne.mockResolvedValue(null);

        const response = await request(app)
            .post('/api/auth/forgot-password/request')
            .send({ phoneNumber: '+254700000000' });

        expect(response.status).toBe(200);
        expect(response.body.authStage).toBe('PASSWORD_RESET_OTP_REQUIRED');
        expect(response.body.authIntent).toBe('PASSWORD_RESET');
    });

    // Reset flow validates OTP purpose+value and updates stored hash atomically.
    test('resets password with a valid reset OTP', async () => {
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
});
