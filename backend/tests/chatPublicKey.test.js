/**
 * chatPublicKey.test.js
 * ---------------------
 * Tests for the ECDH public-key exchange endpoints backing direct-chat E2EE:
 *   GET /api/chat/public-key/:userId — getPublicKey
 *   PUT /api/chat/public-key         — setPublicKey
 */

const request = require('supertest');
const express = require('express');

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

jest.mock('../src/services/chatAccessService', () => ({
  getActorContextByUserId:        jest.fn(),
  ensureAutoChannelsForSurvivor:  jest.fn().mockResolvedValue([]),
  canUserAccessChannel:           jest.fn().mockResolvedValue(true),
  getChannelParticipantUserIds:   jest.fn().mockResolvedValue([])
}));

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
    update:   jest.fn()
  },
  CounsellorProfile: {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn()
  },
  LegalCounselProfile: {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn()
  }
}));

const jwt = require('jsonwebtoken');
const { UserAccount } = require('../src/models');

const REQUESTER_USER_ID  = 'requester-user-uuid';
const COUNTERPART_USER_ID = 'counterpart-user-uuid';
const SAMPLE_JWK = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' });

function buildApp() {
  const app = express();
  app.use(express.json());

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
  app.get('/api/chat/public-key/:userId', authMiddleware, chatController.getPublicKey);
  app.put('/api/chat/public-key', authMiddleware, chatController.setPublicKey);

  return app;
}

function makeToken(payload) {
  jwt.verify.mockReturnValueOnce(payload);
  return `mock-bearer-${Date.now()}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/chat/public-key/:userId', () => {
  it('requires authentication', async () => {
    const app = buildApp();
    jwt.verify.mockImplementationOnce(() => { throw new Error('invalid'); });

    const res = await request(app)
      .get(`/api/chat/public-key/${COUNTERPART_USER_ID}`)
      .set('Authorization', 'Bearer bad-token');

    expect(res.status).toBe(401);
  });

  it('returns 404 when the target user has no registered public key', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });
    UserAccount.findByPk.mockResolvedValue({ userId: COUNTERPART_USER_ID, ecdhPublicKey: null });

    const res = await request(app)
      .get(`/api/chat/public-key/${COUNTERPART_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when the target user does not exist', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });
    UserAccount.findByPk.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/chat/public-key/nonexistent-user')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns the stored public key when present', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });
    UserAccount.findByPk.mockResolvedValue({ userId: COUNTERPART_USER_ID, ecdhPublicKey: SAMPLE_JWK });

    const res = await request(app)
      .get(`/api/chat/public-key/${COUNTERPART_USER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: COUNTERPART_USER_ID, ecdhPublicKey: SAMPLE_JWK });
  });
});

describe('PUT /api/chat/public-key', () => {
  it('requires authentication', async () => {
    const app = buildApp();
    jwt.verify.mockImplementationOnce(() => { throw new Error('invalid'); });

    const res = await request(app)
      .put('/api/chat/public-key')
      .set('Authorization', 'Bearer bad-token')
      .send({ ecdhPublicKey: SAMPLE_JWK });

    expect(res.status).toBe(401);
  });

  it('rejects a missing ecdhPublicKey body field', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });

    const res = await request(app)
      .put('/api/chat/public-key')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(UserAccount.update).not.toHaveBeenCalled();
  });

  it('rejects an empty-string ecdhPublicKey', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });

    const res = await request(app)
      .put('/api/chat/public-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ ecdhPublicKey: '   ' });

    expect(res.status).toBe(400);
    expect(UserAccount.update).not.toHaveBeenCalled();
  });

  it('persists the public key on the caller\'s own row', async () => {
    const app = buildApp();
    const token = makeToken({ userId: REQUESTER_USER_ID });
    UserAccount.update.mockResolvedValue([1]);

    const res = await request(app)
      .put('/api/chat/public-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ ecdhPublicKey: SAMPLE_JWK });

    expect(res.status).toBe(200);
    expect(UserAccount.update).toHaveBeenCalledWith(
      { ecdhPublicKey: SAMPLE_JWK },
      { where: { userId: REQUESTER_USER_ID } }
    );
  });
});
