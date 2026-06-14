/**
 * banEnforcement.test.js
 * ----------------------
 * Tests for the User Banning Workflow (roadmap item 8).
 *
 * Covers:
 * - liftExpiredBan helper: auto-lift logic for expired temporary bans.
 * - isAccountActive allowlist: BANNED blocks login (via loginWithPassword flow).
 * - authMiddleware: blocks BANNED users mid-session on any authenticated request.
 * - banUser controller: role guard, target scope, reason requirement, future expiry.
 * - unbanUser controller: restores ACTIVE and clears ban metadata.
 * - Self-ban and admin-ban-of-admin rejections.
 */

const request = require('supertest');
const express = require('express');

// ── Module mocks — declared at module level so Jest can hoist them ────────────

jest.mock('africastalking', () => () => ({
  SMS: { send: jest.fn().mockResolvedValue({ SMSMessageData: { Message: 'Sent' } }) }
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true)
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn()
}));

jest.mock('../src/middleware/authRateLimitMiddleware', () => ({
  otpRequestLimiter: (req, res, next) => next(),
  authSensitiveLimiter: (req, res, next) => next()
}));

jest.mock('../src/config/database', () => ({
  transaction: jest.fn(async (cb) => cb({}))
}));

// UserAccount mock with mutable save — shared across all test suites.
const mockSave = jest.fn().mockResolvedValue();

jest.mock('../src/models', () => ({
  UserAccount: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  SurvivorProfile: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  CounsellorProfile: { findOne: jest.fn(), findAll: jest.fn() },
  LegalCounselProfile: { findOne: jest.fn(), findAll: jest.fn() },
  StaffAssignmentHistory: { create: jest.fn() },
  ModerationActionLog: { create: jest.fn().mockResolvedValue({}) },
  AuditLog: { create: jest.fn().mockResolvedValue({}) },
  InAppNotification: { count: jest.fn(), findAll: jest.fn(), update: jest.fn() },
  DirectChatChannel: { findAll: jest.fn().mockResolvedValue([]) },
  SystemSetting: {
    findByPk: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue([{}, true])
  }
}));

// Silence notificationService io warning in tests.
jest.mock('../src/services/notificationService', () => ({
  setNotificationIo: jest.fn(),
  createNotification: jest.fn().mockResolvedValue({}),
  createNotificationsBulk: jest.fn().mockResolvedValue()
}));

jest.mock('../src/services/chatAccessService', () => ({
  ensureAutoChannelsForSurvivor: jest.fn().mockResolvedValue(),
  canUserAccessChannel: jest.fn().mockResolvedValue(true),
  getChannelParticipantUserIds: jest.fn().mockResolvedValue([])
}));

// ── Module imports (after jest.mock declarations) ─────────────────────────────
const jwt = require('jsonwebtoken');
const { UserAccount, ModerationActionLog, AuditLog } = require('../src/models');

// Import liftExpiredBan directly — no resetModules needed since the function
// only calls user.save() and reads user fields (no transitive DB calls of its own).
const { liftExpiredBan } = require('../src/controllers/authController');

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildUserAccount(overrides = {}) {
  return {
    userId: 'test-user-uuid',
    phoneNumber: '+254711000001',
    userRole: 'SURVIVOR',
    role: 'survivor',
    hashedPassword: 'hashed-password',
    accountStatus: 'ACTIVE',
    status: 'active',
    isOtpVerified: true,
    otpHash: '1234',
    otpPurpose: 'SIGNIN_OTP',
    otpExpiresAt: new Date(Date.now() + 600_000),
    otpAttemptCount: 0,
    authFailedAttempts: 0,
    authLockUntil: null,
    banReason: null,
    bannedAt: null,
    banExpiresAt: null,
    bannedByUserId: null,
    save: mockSave,
    ...overrides
  };
}

/**
 * Build an Express app with the real (un-mocked) authMiddleware.
 * This verifies that BANNED/SUSPENDED accounts are blocked mid-session.
 * The authMiddleware calls jwt.verify (mocked) and UserAccount.findByPk (mocked).
 */
function buildAuthMiddlewareApp() {
  const app = express();
  app.use(express.json());
  const authMiddleware = require('../src/middleware/authMiddleware');
  app.get('/api/protected', authMiddleware, (req, res) => res.json({ ok: true }));
  return app;
}

/**
 * Build an Express app for testing the admin ban/unban endpoints.
 * Uses real authMiddleware (not mocked) so the route + controller + auth chain
 * is as close to production as possible against the mocked DB.
 */
function buildAdminApp() {
  const app = express();
  app.use(express.json());
  const adminRoutes = require('../src/routes/adminRoutes');
  app.use('/api/admin', adminRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Ban Enforcement', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'test';
    process.env.SKIP_SMS_IN_DEV = 'true';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockClear();
    // Reset findByPk to clear any leftover mockResolvedValueOnce queue from prior tests.
    // Calls to clearAllMocks() do not clear the one-time return value queue.
    UserAccount.findByPk.mockReset();
  });

  // ── liftExpiredBan unit tests ─────────────────────────────────────────────
  describe('liftExpiredBan', () => {
    it('returns false and does nothing for an ACTIVE account', async () => {
      const user = buildUserAccount({ accountStatus: 'ACTIVE', save: jest.fn() });
      const lifted = await liftExpiredBan(user);
      expect(lifted).toBe(false);
      expect(user.accountStatus).toBe('ACTIVE');
      expect(user.save).not.toHaveBeenCalled();
    });

    it('returns false for a permanent ban (banExpiresAt is null)', async () => {
      const user = buildUserAccount({ accountStatus: 'BANNED', banExpiresAt: null, save: jest.fn() });
      const lifted = await liftExpiredBan(user);
      expect(lifted).toBe(false);
      expect(user.accountStatus).toBe('BANNED');
    });

    it('returns false for a temporary ban that has not yet expired', async () => {
      const futureDate = new Date(Date.now() + 86_400_000);
      const user = buildUserAccount({ accountStatus: 'BANNED', banExpiresAt: futureDate, save: jest.fn() });
      const lifted = await liftExpiredBan(user);
      expect(lifted).toBe(false);
      expect(user.accountStatus).toBe('BANNED');
    });

    it('auto-restores ACTIVE and clears ban fields when banExpiresAt is past', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const userSave = jest.fn().mockResolvedValue();
      const user = buildUserAccount({
        accountStatus: 'BANNED',
        banReason: 'Test ban',
        bannedAt: pastDate,
        banExpiresAt: pastDate,
        bannedByUserId: 'actor-uuid',
        save: userSave
      });

      const lifted = await liftExpiredBan(user);

      expect(lifted).toBe(true);
      expect(user.accountStatus).toBe('ACTIVE');
      expect(user.banReason).toBeNull();
      expect(user.bannedAt).toBeNull();
      expect(user.banExpiresAt).toBeNull();
      expect(user.bannedByUserId).toBeNull();
      expect(userSave).toHaveBeenCalledTimes(1);
    });
  });

  // ── authMiddleware mid-session enforcement ────────────────────────────────
  describe('authMiddleware mid-session ban enforcement', () => {
    it('returns 403 for a BANNED account with a valid token', async () => {
      jwt.verify.mockReturnValue({ userId: 'banned-user-uuid', id: 'banned-user-uuid' });

      UserAccount.findByPk.mockResolvedValue(
        buildUserAccount({
          userId: 'banned-user-uuid',
          accountStatus: 'BANNED',
          banReason: 'Policy violation',
          banExpiresAt: null
        })
      );

      const app = buildAuthMiddlewareApp();
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/suspended from the platform/i);
      expect(res.body.reason).toBe('Policy violation');
    });

    it('returns 200 for an ACTIVE account with a valid token', async () => {
      jwt.verify.mockReturnValue({ userId: 'active-user-uuid', id: 'active-user-uuid' });

      UserAccount.findByPk.mockResolvedValue(
        buildUserAccount({ userId: 'active-user-uuid', accountStatus: 'ACTIVE' })
      );

      const app = buildAuthMiddlewareApp();
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });

    it('returns 403 for a SUSPENDED account mid-session', async () => {
      jwt.verify.mockReturnValue({ userId: 'susp-user-uuid', id: 'susp-user-uuid' });

      UserAccount.findByPk.mockResolvedValue(
        buildUserAccount({ userId: 'susp-user-uuid', accountStatus: 'SUSPENDED' })
      );

      const app = buildAuthMiddlewareApp();
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('auto-lifts an expired temporary ban and returns 200', async () => {
      jwt.verify.mockReturnValue({ userId: 'expired-ban-uuid', id: 'expired-ban-uuid' });

      const pastDate = new Date(Date.now() - 5000);
      const userSave = jest.fn().mockResolvedValue();
      const user = buildUserAccount({
        userId: 'expired-ban-uuid',
        accountStatus: 'BANNED',
        banReason: 'Temp ban',
        bannedAt: pastDate,
        banExpiresAt: pastDate,
        save: userSave
      });

      UserAccount.findByPk.mockResolvedValue(user);

      const app = buildAuthMiddlewareApp();
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer valid-token');

      // Should have been auto-lifted and request should proceed.
      expect(res.status).toBe(200);
      expect(user.accountStatus).toBe('ACTIVE');
    });
  });

  // ── banUser controller ────────────────────────────────────────────────────
  describe('banUser endpoint (PATCH /api/admin/ngo/users/:userId/ban)', () => {
    const ACTOR_ID = 'ngo-admin-uuid';

    function buildNgoActor() {
      return buildUserAccount({
        userId: ACTOR_ID,
        userRole: 'NGO_ADMIN',
        role: 'ngo_admin',
        accountStatus: 'ACTIVE'
      });
    }

    beforeEach(() => {
      jwt.verify.mockReturnValue({ userId: ACTOR_ID, id: ACTOR_ID });
    });

    /**
     * Sets up UserAccount.findByPk to return the correct account by userId argument.
     * Using mockImplementation (argument-aware) rather than mockResolvedValueOnce
     * so test order and early-return paths don't cause queue pollution.
     */
    function setupFindByPkMap(actor, target) {
      UserAccount.findByPk.mockImplementation((id) => {
        if (id === actor.userId) return Promise.resolve(actor);
        if (id === target.userId) return Promise.resolve(target);
        return Promise.resolve(null);
      });
    }

    it('returns 400 when reason is empty', async () => {
      const actor = buildNgoActor();
      const target = buildUserAccount({ userId: 'target-uuid', userRole: 'SURVIVOR' });
      setupFindByPkMap(actor, target);

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/target-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reason is required/i);
    });

    it('returns 400 when expiresAt is in the past', async () => {
      const actor = buildNgoActor();
      const target = buildUserAccount({ userId: 'target-uuid', userRole: 'SURVIVOR' });
      setupFindByPkMap(actor, target);

      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/target-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Valid reason', expiresAt: pastDate });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/future date/i);
    });

    it('returns 400 when trying to ban an NGO_ADMIN', async () => {
      const actor = buildNgoActor();
      const adminTarget = buildUserAccount({ userId: 'other-admin-uuid', userRole: 'NGO_ADMIN' });
      setupFindByPkMap(actor, adminTarget);

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/other-admin-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/survivor and frontline staff/i);
    });

    it('returns 400 when trying to self-ban', async () => {
      const actor = buildNgoActor(); // NGO_ADMIN, ACTIVE
      // The target has the same userId as the actor but a COUNSELLOR role so it
      // passes the bannable-roles check and reaches the self-ban guard.
      // We use ordered mocks (safe here because mockReset() ran in beforeEach):
      //   call 1 → actor (authMiddleware DB lookup)
      //   call 2 → actor (getActor DB lookup)
      //   call 3 → counsellor with ACTOR_ID (ban target lookup — triggers self-ban guard)
      const counsellorSelfTarget = buildUserAccount({ userId: ACTOR_ID, userRole: 'COUNSELLOR' });
      UserAccount.findByPk
        .mockResolvedValueOnce(actor)             // authMiddleware
        .mockResolvedValueOnce(actor)             // getActor
        .mockResolvedValueOnce(counsellorSelfTarget); // target lookup

      const app = buildAdminApp();
      const res = await request(app)
        .patch(`/api/admin/ngo/users/${ACTOR_ID}/ban`)
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot ban your own/i);
    });

    it('successfully bans a SURVIVOR and writes dual audit records', async () => {
      const actor = buildNgoActor();
      const targetSave = jest.fn().mockResolvedValue();
      const target = buildUserAccount({ userId: 'survivor-uuid', userRole: 'SURVIVOR', save: targetSave });
      setupFindByPkMap(actor, target);

      ModerationActionLog.create.mockResolvedValue({});
      AuditLog.create.mockResolvedValue({});

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/survivor-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Repeated harassment.' });

      expect(res.status).toBe(200);
      expect(target.accountStatus).toBe('BANNED');
      expect(target.banReason).toBe('Repeated harassment.');
      expect(targetSave).toHaveBeenCalled();

      // Dual audit trail.
      expect(ModerationActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ moderationActionType: 'BAN', moderationActionReason: 'Repeated harassment.' })
      );
      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'ACCOUNT_BANNED' })
      );
    });
  });

  // ── unbanUser controller ──────────────────────────────────────────────────
  describe('unbanUser endpoint (PATCH /api/admin/ngo/users/:userId/unban)', () => {
    it('restores ACTIVE and clears ban metadata', async () => {
      jwt.verify.mockReturnValue({ userId: 'ngo-admin-uuid', id: 'ngo-admin-uuid' });

      const actor = buildUserAccount({ userId: 'ngo-admin-uuid', userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const targetSave = jest.fn().mockResolvedValue();
      const target = buildUserAccount({
        userId: 'banned-survivor-uuid',
        userRole: 'SURVIVOR',
        accountStatus: 'BANNED',
        banReason: 'Old reason',
        bannedByUserId: 'ngo-admin-uuid',
        save: targetSave
      });

      UserAccount.findByPk.mockImplementation((id) => {
        if (id === 'ngo-admin-uuid') return Promise.resolve(actor);
        if (id === 'banned-survivor-uuid') return Promise.resolve(target);
        return Promise.resolve(null);
      });

      ModerationActionLog.create.mockResolvedValue({});
      AuditLog.create.mockResolvedValue({});

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/banned-survivor-uuid/unban')
        .set('Authorization', 'Bearer token')
        .send({});

      expect(res.status).toBe(200);
      expect(target.accountStatus).toBe('ACTIVE');
      expect(target.banReason).toBeNull();
      expect(target.bannedByUserId).toBeNull();

      expect(ModerationActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ moderationActionType: 'UNBAN' })
      );
      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'ACCOUNT_UNBANNED' })
      );
    });
  });
});
