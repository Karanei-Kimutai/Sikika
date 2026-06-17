/**
 * chatTrashRestore.test.js
 * ------------------------
 * Tests for the chat Trash/Restore lifecycle (Item 2 of tidy-gliding-mist.md).
 *
 * Covers:
 * A. Status transitions allowed / blocked:
 *    - active   → deleted  (move to Trash)                         ✅ allowed
 *    - archived → deleted  (move to Trash from archive)            ✅ allowed
 *    - deleted  → active   (restore from Trash)                    ✅ allowed  ← NEW
 *    - deleted  → archived (invalid transition out of Trash)       ❌ blocked
 *    - deleted  → deleted  (no-op)                                 ❌ blocked
 *
 * B. Ownership / role guards:
 *    - Owner survivor may restore deleted → active                 ✅ allowed
 *    - Non-owner survivor (different survivorId)                   ❌ 403
 *    - COUNSELLOR actor                                            ❌ 403
 *    - LEGAL_COUNSEL actor                                         ❌ 403
 *
 * C. getChannels includeDeleted contract per role:
 *    - Survivor + includeDeleted=true  → deleted channel returned
 *    - Survivor + no param             → active only (deleted omitted)
 *    - Survivor + includeDeleted=false → active only
 *    - COUNSELLOR + includeDeleted=true → active only (not exposed)
 *    - LEGAL_COUNSEL + includeDeleted=true → active only
 *    - NGO_ADMIN → 403
 *    - MODERATOR → 403
 */

const request = require('supertest');
const express = require('express');

// ── Module-level mocks (hoisted by Jest) ─────────────────────────────────────

jest.mock('jsonwebtoken', () => ({
  sign:   jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn()
}));

jest.mock('../src/middleware/authRateLimitMiddleware', () => ({
  otpRequestLimiter:    (req, res, next) => next(),
  authSensitiveLimiter: (req, res, next) => next()
}));

jest.mock('../src/services/presenceRegistry', () => ({
  getEffectivePresence: jest.fn().mockReturnValue('OFFLINE'),
  markOnline:           jest.fn(),
  markOffline:          jest.fn()
}));

jest.mock('../src/services/notificationService', () => ({
  setNotificationIo:       jest.fn(),
  createNotification:      jest.fn().mockResolvedValue({}),
  createNotificationsBulk: jest.fn().mockResolvedValue()
}));

jest.mock('../src/services/chatAccessService', () => ({
  getActorContextByUserId:        jest.fn(),
  ensureAutoChannelsForSurvivor:  jest.fn().mockResolvedValue([]),
  canUserAccessChannel:           jest.fn().mockResolvedValue(true),
  getChannelParticipantUserIds:   jest.fn().mockResolvedValue([])
}));

// Shared mock save — must be prefixed with 'mock' for Jest hoisting.
const mockSave = jest.fn().mockResolvedValue();

jest.mock('../src/models', () => ({
  DirectChatChannel: {
    findByPk: jest.fn(),
    findAll:  jest.fn()
  },
  DirectChatMessage: {
    count:   jest.fn().mockResolvedValue(0),
    findAll: jest.fn().mockResolvedValue([]),
    update:  jest.fn().mockResolvedValue([0])
  },
  SurvivorProfile: {
    findOne:  jest.fn(),
    findByPk: jest.fn()
  },
  UserAccount: {
    findByPk: jest.fn(),
    findOne:  jest.fn()
  },
  CounsellorProfile: {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn()
  },
  LegalCounselProfile: {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn()
  }
  // Note: Op is imported directly from 'sequelize' in the controller, not via models.
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const { Op }               = require('sequelize');
const {
  DirectChatChannel,
  DirectChatMessage,
  SurvivorProfile,
  UserAccount,
  CounsellorProfile,
  LegalCounselProfile
}                          = require('../src/models');
const {
  getActorContextByUserId,
  ensureAutoChannelsForSurvivor
}                          = require('../src/services/chatAccessService');

// ── Fixture IDs ───────────────────────────────────────────────────────────────
const SURVIVOR_USER_ID   = 'survivor-user-uuid';
const SURVIVOR_ID        = 'survivor-profile-uuid';
const COUNSELLOR_USER_ID = 'counsellor-user-uuid';
const CHAT_ID            = 'chat-channel-uuid';

// ── In-memory channel shared across tests in each describe block ──────────────
let mockChannel = null;

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // Shim: validate JWT and populate req.user from the mocked jwt.verify return value.
  const authMiddleware = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token  = header.replace('Bearer ', '');
    try {
      req.user = jwt.verify(token, 'secret');
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized.' });
    }
  };

  const chatController = require('../src/controllers/chatController');
  app.get('/api/chat/channels', authMiddleware, chatController.getChannels);
  app.patch('/api/chat/:chatId/status', authMiddleware, chatController.updateChannelStatus);

  return app;
}

/**
 * Queue a one-time jwt.verify return value and return a token string.
 * @param {object} payload
 * @returns {string}
 */
function makeToken(payload) {
  jwt.verify.mockReturnValueOnce(payload);
  return `mock-bearer-${Date.now()}`;
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue();

  // Default channel: owner survivor, currently active.
  mockChannel = {
    chatId:                    CHAT_ID,
    survivorId:                SURVIVOR_ID,
    supportStaffCounterpartId: COUNSELLOR_USER_ID,
    chatChannelType:           'counsellor_channel',
    chatChannelStatus:         'active',
    chatCreationTimestamp:     new Date(),
    save:                      mockSave,
    toJSON() {
      const { save, toJSON, ...rest } = this;
      return rest;
    }
  };

  DirectChatChannel.findByPk.mockResolvedValue(mockChannel);
  DirectChatChannel.findAll.mockResolvedValue([mockChannel]);

  // Survivor profile for the owner.
  SurvivorProfile.findOne.mockResolvedValue({ survivorId: SURVIVOR_ID });
  SurvivorProfile.findByPk.mockResolvedValue({ survivorId: SURVIVOR_ID, userId: SURVIVOR_USER_ID });

  // chatAccessService default: owner survivor actor.
  getActorContextByUserId.mockResolvedValue({
    userId:         SURVIVOR_USER_ID,
    role:           'SURVIVOR',
    survivorId:     SURVIVOR_ID,
    counsellorId:   null,
    legalCounselId: null
  });

  // Presence lookups — empty by default.
  CounsellorProfile.findAll.mockResolvedValue([]);
  LegalCounselProfile.findAll.mockResolvedValue([]);
  DirectChatMessage.count.mockResolvedValue(0);
  UserAccount.findByPk.mockResolvedValue({ userId: COUNSELLOR_USER_ID, userRole: 'COUNSELLOR' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. STATUS TRANSITION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('A. Status transitions', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('A1: active → deleted (move to Trash) is allowed', async () => {
    mockChannel.chatChannelStatus = 'active';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' });

    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockChannel.chatChannelStatus).toBe('deleted');
  });

  test('A2: archived → deleted (move archived chat to Trash) is allowed', async () => {
    mockChannel.chatChannelStatus = 'archived';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' });

    expect(res.status).toBe(200);
    expect(mockChannel.chatChannelStatus).toBe('deleted');
  });

  test('A3: deleted → active (restore from Trash) is allowed — NEW in this PR', async () => {
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(mockChannel.chatChannelStatus).toBe('active');
    expect(res.body.message).toMatch(/restored/i);
  });

  test('A4: deleted → archived (invalid transition) is blocked with 400', async () => {
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'archived' });

    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('A5: deleted → deleted (no-op) is blocked with 400', async () => {
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' });

    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. OWNERSHIP / ROLE GUARD TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('B. Ownership and role guards', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('B1: owner survivor can restore a deleted channel', async () => {
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
  });

  test('B2: non-owner survivor (different survivorId) is rejected with 403', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         'other-survivor-user',
      role:           'SURVIVOR',
      survivorId:     'other-survivor-id',   // does not match mockChannel.survivorId
      counsellorId:   null,
      legalCounselId: null
    });
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: 'other-survivor-user', id: 'other-survivor-user' });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(res.status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('B3: COUNSELLOR is rejected (survivor-only endpoint)', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         COUNSELLOR_USER_ID,
      role:           'COUNSELLOR',
      survivorId:     null,
      counsellorId:   'c1',
      legalCounselId: null
    });
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: COUNSELLOR_USER_ID, id: COUNSELLOR_USER_ID });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(res.status).toBe(403);
  });

  test('B4: LEGAL_COUNSEL is rejected (survivor-only endpoint)', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         'legal-user',
      role:           'LEGAL_COUNSEL',
      survivorId:     null,
      counsellorId:   null,
      legalCounselId: 'lc1'
    });
    mockChannel.chatChannelStatus = 'deleted';
    const token = makeToken({ userId: 'legal-user', id: 'legal-user' });

    const res = await request(app)
      .patch(`/api/chat/${CHAT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. getChannels includeDeleted contract per role
// ═══════════════════════════════════════════════════════════════════════════════

describe('C. getChannels includeDeleted contract', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  /**
   * Capture the chatChannelStatus.$in arg passed to DirectChatChannel.findAll.
   * Uses Sequelize's Op.in Symbol as the key (same Symbol Jest sees at runtime).
   */
  function captureStatusFilter() {
    let captured = null;
    DirectChatChannel.findAll.mockImplementationOnce(async ({ where }) => {
      captured = where?.chatChannelStatus?.[Op.in] || [];
      return [];
    });
    return { getStatuses: () => captured };
  }

  test('C1: survivor + includeDeleted=true → "deleted" in visible statuses', async () => {
    const { getStatuses } = captureStatusFilter();
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`)
      .query({ includeDeleted: 'true' });

    expect(res.status).toBe(200);
    expect(getStatuses()).toContain('deleted');
  });

  test('C2: survivor + no param → active only, "deleted" NOT in visible statuses', async () => {
    const { getStatuses } = captureStatusFilter();
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(getStatuses()).not.toContain('deleted');
    expect(getStatuses()).toContain('active');
  });

  test('C3: survivor + includeDeleted=false → active only', async () => {
    const { getStatuses } = captureStatusFilter();
    const token = makeToken({ userId: SURVIVOR_USER_ID, id: SURVIVOR_USER_ID });

    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`)
      .query({ includeDeleted: 'false' });

    expect(res.status).toBe(200);
    expect(getStatuses()).not.toContain('deleted');
  });

  test('C4: COUNSELLOR + includeDeleted=true → active only (deleted not exposed to staff)', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         COUNSELLOR_USER_ID,
      role:           'COUNSELLOR',
      survivorId:     null,
      counsellorId:   'c1',
      legalCounselId: null
    });
    SurvivorProfile.findOne.mockResolvedValueOnce(null); // not a survivor account

    const { getStatuses } = captureStatusFilter();
    const token = makeToken({ userId: COUNSELLOR_USER_ID, id: COUNSELLOR_USER_ID });

    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`)
      .query({ includeDeleted: 'true' });

    expect(res.status).toBe(200);
    expect(getStatuses()).not.toContain('deleted');
    expect(getStatuses()).toEqual(['active']);
  });

  test('C5: LEGAL_COUNSEL + includeDeleted=true → active only', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         'legal-user',
      role:           'LEGAL_COUNSEL',
      survivorId:     null,
      counsellorId:   null,
      legalCounselId: 'lc1'
    });
    SurvivorProfile.findOne.mockResolvedValueOnce(null);

    const { getStatuses } = captureStatusFilter();
    const token = makeToken({ userId: 'legal-user', id: 'legal-user' });

    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`)
      .query({ includeDeleted: 'true' });

    expect(res.status).toBe(200);
    expect(getStatuses()).not.toContain('deleted');
  });

  test('C6: NGO_ADMIN → 403 (direct chat not available to admins)', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         'ngo-user',
      role:           'NGO_ADMIN',
      survivorId:     null,
      counsellorId:   null,
      legalCounselId: null
    });

    const token = makeToken({ userId: 'ngo-user', id: 'ngo-user' });
    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('C7: MODERATOR → 403 (direct chat not available to admins)', async () => {
    getActorContextByUserId.mockResolvedValueOnce({
      userId:         'moderator-1',
      role:           'MODERATOR',
      survivorId:     null,
      counsellorId:   null,
      legalCounselId: null
    });

    const token = makeToken({ userId: 'moderator-1', id: 'moderator-1' });
    const res = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
