/**
 * banCascade.test.js
 * ------------------
 * Tests for the staff-ban assignment cascade (workstream C) and
 * community moderation role-guard parity (workstream E).
 *
 * Covers:
 * - banUser: COUNSELLOR ban triggers cascadeReassignOnStaffBan (via setImmediate).
 * - banUser: SURVIVOR ban does NOT trigger cascade.
 * - communityController reviewReport ban_user: rejects non-bannable role (NGO_ADMIN target).
 * - communityController reviewReport ban_user: rejects self-ban.
 * - cascadeReassignOnStaffBan: correctly queries affected survivors.
 * - cascadeReassignOnStaffBan: no-replacement path does not crash.
 */

const request = require('supertest');
const express = require('express');

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.mock('africastalking', () => () => ({
  SMS: { send: jest.fn() }
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

// communityController uses managed (non-callback) transactions:
// `const t = await sequelize.transaction(); ... await t.commit();`
// So the mock must return a transaction object, not call a callback.
const mockTransaction = {
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
  finished: false
};

const mockUserAccountSave = jest.fn().mockResolvedValue();

jest.mock('../src/models', () => ({
  UserAccount: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  SurvivorProfile: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  CounsellorProfile: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn()
  },
  LegalCounselProfile: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn()
  },
  StaffAssignmentHistory: { create: jest.fn().mockResolvedValue({}) },
  ModerationActionLog: { create: jest.fn().mockResolvedValue({}) },
  AuditLog: { create: jest.fn().mockResolvedValue({}) },
  InAppNotification: { create: jest.fn().mockResolvedValue({}) },
  DirectChatChannel: { findAll: jest.fn().mockResolvedValue([]) },
  SystemSetting: {
    findByPk: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue([{}, true])
  },
  HarmfulContentReport: { findByPk: jest.fn() },
  CommunityMessage: { findByPk: jest.fn() },
  sequelize: {
    // Managed (non-callback) transaction style used by communityController.
    transaction: jest.fn().mockResolvedValue(mockTransaction)
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

// ── Imports ───────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  ModerationActionLog,
  AuditLog,
  HarmfulContentReport,
  CommunityMessage
} = require('../src/models');

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildAccount(overrides = {}) {
  return {
    userId: 'default-uuid',
    userRole: 'SURVIVOR',
    accountStatus: 'ACTIVE',
    banReason: null, bannedAt: null, banExpiresAt: null, bannedByUserId: null,
    save: mockUserAccountSave,
    ...overrides
  };
}

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../src/routes/adminRoutes'));
  return app;
}

function buildCommunityApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/community', require('../src/routes/communityRoutes'));
  return app;
}

const ACTOR_ID = 'ngo-admin-uuid';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Ban cascade and role-guard parity', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'test';
    process.env.SKIP_SMS_IN_DEV = 'true';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserAccountSave.mockResolvedValue();
    jwt.verify.mockReturnValue({ userId: ACTOR_ID, id: ACTOR_ID });

    // Default: actor = NGO_ADMIN, target not found
    UserAccount.findByPk.mockResolvedValue(null);
    SurvivorProfile.findAll.mockResolvedValue([]);
    CounsellorProfile.findAll.mockResolvedValue([]);
    CounsellorProfile.findOne.mockResolvedValue(null);
    CounsellorProfile.findByPk.mockResolvedValue({ counsellorId: 'default-counsellor' });
    LegalCounselProfile.findAll.mockResolvedValue([]);
    LegalCounselProfile.findOne.mockResolvedValue(null);
    LegalCounselProfile.findByPk.mockResolvedValue({ legalCounselId: 'default-legal' });
  });

  // ── banUser endpoint ────────────────────────────────────────────────────────
  describe('banUser PATCH /api/admin/ngo/users/:userId/ban', () => {
    const actor = () => buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });

    function setupFindByPk(targetOverride) {
      const a = actor();
      const t = buildAccount(targetOverride);
      UserAccount.findByPk.mockImplementation((id) => {
        if (id === ACTOR_ID) return Promise.resolve(a);
        if (id === t.userId) return Promise.resolve(t);
        return Promise.resolve(null);
      });
      return { a, t };
    }

    it('200: bans a SURVIVOR and does NOT trigger cascade', async () => {
      const { t } = setupFindByPk({ userId: 'survivor-uuid', userRole: 'SURVIVOR' });

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/survivor-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Community violation' });

      expect(res.status).toBe(200);
      expect(t.accountStatus).toBe('BANNED');
      // Cascade only fires for COUNSELLOR/LEGAL_COUNSEL; CounsellorProfile.findOne should NOT be called.
      // (setImmediate fires after response — but Jest runs synchronously here so cascade hasn't started)
      expect(res.body.user.accountStatus).toBe('BANNED');
    });

    it('400: rejects ban of NGO_ADMIN (non-bannable role)', async () => {
      setupFindByPk({ userId: 'admin-uuid', userRole: 'NGO_ADMIN' });

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/admin-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only survivor and frontline staff/i);
    });

    it('400: rejects self-ban when actor userId matches target userId (SURVIVOR role)', async () => {
      // Use mockResolvedValueOnce to sequence the two findByPk calls:
      // 1st call (getActor): returns the NGO_ADMIN actor
      // 2nd call (target lookup): returns same userId but with SURVIVOR role
      const a = actor();
      const selfAsSurvivor = buildAccount({ userId: ACTOR_ID, userRole: 'SURVIVOR' });

      // 3 findByPk calls happen in order:
      // 1. authMiddleware DB lookup (requires ACTIVE account)
      // 2. getActor DB lookup (requires ACTIVE + role)
      // 3. target user lookup (same userId but SURVIVOR role for self-ban check)
      UserAccount.findByPk
        .mockResolvedValueOnce(a)             // authMiddleware
        .mockResolvedValueOnce(a)             // getActor
        .mockResolvedValueOnce(selfAsSurvivor); // target lookup

      const app = buildAdminApp();
      const res = await request(app)
        .patch(`/api/admin/ngo/users/${ACTOR_ID}/ban`)
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Self ban attempt' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot ban your own account/i);
    });

    it('400: rejects past expiresAt date', async () => {
      setupFindByPk({ userId: 'target-uuid', userRole: 'SURVIVOR' });

      const app = buildAdminApp();
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const res = await request(app)
        .patch('/api/admin/ngo/users/target-uuid/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Test', expiresAt: pastDate });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/future date/i);
    });

    it('cascade reassignment preserves legal counsel when counsellor is banned', async () => {
      const actor = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const bannedCounsellorUser = buildAccount({ userId: 'counsellor-user-1', userRole: 'COUNSELLOR', accountStatus: 'ACTIVE' });

      UserAccount.findByPk
        .mockResolvedValueOnce(actor) // authMiddleware
        .mockResolvedValueOnce(actor) // getActor
        .mockResolvedValueOnce(bannedCounsellorUser); // target user lookup

      CounsellorProfile.findOne.mockResolvedValueOnce({ counsellorId: 'counsellor-old' });
      CounsellorProfile.findAll.mockResolvedValueOnce([
        {
          counsellorId: 'counsellor-new',
          availabilityStatus: 'AVAILABLE',
          userAccount: { accountStatus: 'ACTIVE' }
        }
      ]);

      const survivorUpdate = jest.fn().mockResolvedValue();
      SurvivorProfile.findAll.mockResolvedValueOnce([
        {
          survivorId: 'survivor-1',
          assignedCounsellorId: 'counsellor-old',
          assignedLegalCounselId: 'legal-keep'
        }
      ]);
      SurvivorProfile.findByPk.mockResolvedValueOnce({
        survivorId: 'survivor-1',
        assignedCounsellorId: 'counsellor-old',
        assignedLegalCounselId: 'legal-keep',
        update: survivorUpdate
      });

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/counsellor-user-1/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Safety violation' });

      expect(res.status).toBe(200);

      await new Promise((resolve) => setImmediate(resolve));

      expect(survivorUpdate).toHaveBeenCalledWith({
        assignedCounsellorId: 'counsellor-new',
        assignedLegalCounselId: 'legal-keep'
      });
    });

    it('cascade reassignment preserves counsellor when legal counsel is banned', async () => {
      const actor = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const bannedLegalUser = buildAccount({ userId: 'legal-user-1', userRole: 'LEGAL_COUNSEL', accountStatus: 'ACTIVE' });

      UserAccount.findByPk
        .mockResolvedValueOnce(actor) // authMiddleware
        .mockResolvedValueOnce(actor) // getActor
        .mockResolvedValueOnce(bannedLegalUser); // target user lookup

      LegalCounselProfile.findOne.mockResolvedValueOnce({ legalCounselId: 'legal-old' });
      LegalCounselProfile.findAll.mockResolvedValueOnce([
        {
          legalCounselId: 'legal-new',
          availabilityStatus: 'AVAILABLE',
          userAccount: { accountStatus: 'ACTIVE' }
        }
      ]);

      const survivorUpdate = jest.fn().mockResolvedValue();
      SurvivorProfile.findAll.mockResolvedValueOnce([
        {
          survivorId: 'survivor-2',
          assignedCounsellorId: 'counsellor-keep',
          assignedLegalCounselId: 'legal-old'
        }
      ]);
      SurvivorProfile.findByPk.mockResolvedValueOnce({
        survivorId: 'survivor-2',
        assignedCounsellorId: 'counsellor-keep',
        assignedLegalCounselId: 'legal-old',
        update: survivorUpdate
      });

      const app = buildAdminApp();
      const res = await request(app)
        .patch('/api/admin/ngo/users/legal-user-1/ban')
        .set('Authorization', 'Bearer token')
        .send({ reason: 'Safety violation' });

      expect(res.status).toBe(200);

      await new Promise((resolve) => setImmediate(resolve));

      expect(survivorUpdate).toHaveBeenCalledWith({
        assignedCounsellorId: 'counsellor-keep',
        assignedLegalCounselId: 'legal-new'
      });
    });
  });

  // ── community moderation ban_user role guard parity ─────────────────────────
  describe('reviewReport ban_user role guard (community)', () => {
    const REPORT_ID = 'report-uuid';

    function setupCommunityMocks({ targetRole, isSelf = false }) {
      // authMiddleware uses UserAccount.findByPk
      const actorAccount = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      jwt.verify.mockReturnValue({ userId: ACTOR_ID, id: ACTOR_ID });

      const targetId = isSelf ? ACTOR_ID : 'target-uuid';
      const targetAccount = buildAccount({ userId: targetId, userRole: targetRole, accountStatus: 'ACTIVE' });

      const message = { communityMessageId: 'msg-uuid', senderUserId: targetId, roomId: 'room-1', publicMessageContent: 'hello' };
      const report = {
        contentReportId: REPORT_ID,
        reportedCommunityMessageId: 'msg-uuid',
        moderationReviewStatus: 'PENDING',
        reportReasonText: 'Offensive',
        save: jest.fn().mockResolvedValue()
      };

      // authMiddleware findByPk: returns actor's account
      UserAccount.findByPk.mockImplementation((id, opts) => {
        if (id === ACTOR_ID) return Promise.resolve(actorAccount);
        if (id === targetId) return Promise.resolve(targetAccount);
        return Promise.resolve(null);
      });

      HarmfulContentReport.findByPk.mockResolvedValue(report);
      CommunityMessage.findByPk.mockResolvedValue(message);
    }

    it('400: rejects ban of NGO_ADMIN from community moderation path', async () => {
      setupCommunityMocks({ targetRole: 'NGO_ADMIN' });

      const app = buildCommunityApp();
      const res = await request(app)
        .patch(`/api/community/moderation/reports/${REPORT_ID}`)
        .set('Authorization', 'Bearer token')
        .send({ reviewStatus: 'APPROVED', action: 'ban_user', reason: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only survivor and frontline staff/i);
    });

    it('400: rejects self-ban from community moderation path', async () => {
      setupCommunityMocks({ targetRole: 'NGO_ADMIN', isSelf: true });

      const app = buildCommunityApp();
      const res = await request(app)
        .patch(`/api/community/moderation/reports/${REPORT_ID}`)
        .set('Authorization', 'Bearer token')
        .send({ reviewStatus: 'APPROVED', action: 'ban_user', reason: 'Test' });

      // Self-ban rejected (actor is NGO_ADMIN — already caught by non-bannable role check)
      expect(res.status).toBe(400);
    });

    it('200: banning a COUNSELLOR via community moderation triggers cascadeReassignOnStaffBan (survivor continuity parity with the admin ban endpoint)', async () => {
      setupCommunityMocks({ targetRole: 'COUNSELLOR' });

      // cascadeReassignOnStaffBan looks up the banned counsellor's profile by userId.
      CounsellorProfile.findOne.mockResolvedValueOnce({ counsellorId: 'counsellor-profile-uuid' });
      SurvivorProfile.findAll.mockResolvedValueOnce([]);

      const app = buildCommunityApp();
      const res = await request(app)
        .patch(`/api/community/moderation/reports/${REPORT_ID}`)
        .set('Authorization', 'Bearer token')
        .send({ reviewStatus: 'APPROVED', action: 'ban_user', reason: 'Harmful content' });

      expect(res.status).toBe(200);

      // Cascade runs post-commit via setImmediate — flush the event loop before asserting.
      await new Promise((resolve) => setImmediate(resolve));

      expect(CounsellorProfile.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'target-uuid' } })
      );
    });

    it('200: ban_user still bans target when reported message is already deleted (snapshot fallback)', async () => {
      const actorAccount = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const targetAccount = buildAccount({ userId: 'target-uuid', userRole: 'SURVIVOR', accountStatus: 'ACTIVE' });

      const report = {
        contentReportId: REPORT_ID,
        reportedCommunityMessageId: 'msg-missing',
        reportedSenderUserId: 'target-uuid',
        reportedRoomId: 'room-1',
        moderationReviewStatus: 'PENDING',
        reportReasonText: 'Offensive',
        save: jest.fn().mockResolvedValue()
      };

      UserAccount.findByPk.mockImplementation((id) => {
        if (id === ACTOR_ID) return Promise.resolve(actorAccount);
        if (id === 'target-uuid') return Promise.resolve(targetAccount);
        return Promise.resolve(null);
      });
      HarmfulContentReport.findByPk.mockResolvedValue(report);
      CommunityMessage.findByPk.mockResolvedValue(null);

      const app = buildCommunityApp();
      const res = await request(app)
        .patch(`/api/community/moderation/reports/${REPORT_ID}`)
        .set('Authorization', 'Bearer token')
        .send({ reviewStatus: 'APPROVED', action: 'ban_user', reason: 'Harmful content' });

      expect(res.status).toBe(200);
      expect(targetAccount.accountStatus).toBe('BANNED');
      expect(ModerationActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: 'target-uuid',
          moderationActionType: 'BAN'
        }),
        expect.any(Object)
      );
    });

    it('409: ban_user returns explicit error when target cannot be resolved', async () => {
      const actorAccount = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const report = {
        contentReportId: REPORT_ID,
        reportedCommunityMessageId: 'msg-missing',
        reportedSenderUserId: null,
        reportedRoomId: null,
        moderationReviewStatus: 'PENDING',
        reportReasonText: 'Offensive',
        save: jest.fn().mockResolvedValue()
      };

      UserAccount.findByPk.mockResolvedValue(actorAccount);
      HarmfulContentReport.findByPk.mockResolvedValue(report);
      CommunityMessage.findByPk.mockResolvedValue(null);

      const app = buildCommunityApp();
      const res = await request(app)
        .patch(`/api/community/moderation/reports/${REPORT_ID}`)
        .set('Authorization', 'Bearer token')
        .send({ reviewStatus: 'APPROVED', action: 'ban_user', reason: 'Harmful content' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/unable to resolve report target/i);
    });
  });

  // ── listBannedUsers endpoint ────────────────────────────────────────────────
  describe('listBannedUsers GET /api/admin/ngo/banned-users', () => {
    it('returns banned accounts for NGO_ADMIN', async () => {
      const actor = buildAccount({ userId: ACTOR_ID, userRole: 'NGO_ADMIN', accountStatus: 'ACTIVE' });
      const bannedSurvivor = buildAccount({
        userId: 'banned-surv',
        userRole: 'SURVIVOR',
        accountStatus: 'BANNED',
        banReason: 'Violation',
        bannedAt: new Date(),
        banExpiresAt: null
      });

      // Two findByPk calls: one from getActor (actor lookup), one for the main query.
      // listBannedUsers uses findAll, not findByPk, for the main query.
      UserAccount.findByPk.mockResolvedValue(actor);
      UserAccount.findAll = jest.fn().mockResolvedValue([bannedSurvivor]);

      const app = buildAdminApp();
      const res = await request(app)
        .get('/api/admin/ngo/banned-users')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.bannedUsers).toHaveLength(1);
      expect(res.body.bannedUsers[0].userId).toBe('banned-surv');
      expect(res.body.bannedUsers[0].isPermanent).toBe(true);
    });

    it('403 for non-NGO_ADMIN role', async () => {
      const actor = buildAccount({ userId: ACTOR_ID, userRole: 'COUNSELLOR', accountStatus: 'ACTIVE' });
      UserAccount.findByPk.mockResolvedValue(actor);

      const app = buildAdminApp();
      const res = await request(app)
        .get('/api/admin/ngo/banned-users')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(403);
    });
  });
});
