/**
 * notificationController.test.js
 * --------------------------------
 * Tests for the In-App Notification Center API (roadmap item 3).
 *
 * Covers:
 * - GET /api/notifications — list visible notifications, ?unreadOnly filter.
 * - GET /api/notifications/unread-count — lightweight badge count.
 * - PATCH /api/notifications/:id/read — ownership-checked mark-as-read.
 * - PATCH /api/notifications/read-all — bulk mark-all-read.
 * - PATCH /api/notifications/:id/dismiss — ownership-checked dismiss.
 * - Cross-user access: another user's notificationId returns 404 (not 403,
 *   so attackers cannot enumerate other users' notification IDs).
 */

const request = require('supertest');
const express = require('express');

// Mock jsonwebtoken so we can control decoded payloads without real signing.
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn()
}));

// Mock the models registry — no real DB connection needed.
const mockNotificationSave = jest.fn().mockResolvedValue();

function buildNotification(overrides = {}) {
  return {
    notificationId: 'notif-uuid-1',
    recipientUserId: 'user-uuid-1',
    notificationCategoryType: 'NEW_MESSAGE',
    discreetNotificationMessage: 'You have a new update.',
    notificationReadStatus: 'UNREAD',
    notificationDismissedStatus: 'VISIBLE',
    notificationCreationTimestamp: new Date().toISOString(),
    save: mockNotificationSave,
    ...overrides
  };
}

jest.mock('../src/models', () => ({
  UserAccount: {
    findByPk: jest.fn()
  },
  InAppNotification: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    update: jest.fn()
  }
}));

const jwt = require('jsonwebtoken');
const { UserAccount, InAppNotification } = require('../src/models');

/**
 * Builds an Express test app with a real authMiddleware and notification routes.
 * authMiddleware is NOT mocked here — we wire it up with UserAccount.findByPk
 * so auth enforcement is real (just against mock DB).
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  // Must be required after jest.mock calls so the middleware picks up mocked models.
  const authMiddleware = require('../src/middleware/authMiddleware');
  const notificationRoutes = require('../src/routes/notificationRoutes');

  app.use('/api/notifications', notificationRoutes);
  return app;
}

// ── Test setup ───────────────────────────────────────────────────────────────

describe('Notification Controller', () => {
  let app;
  const TOKEN = 'Bearer mock-token';
  const USER_ID = 'user-uuid-1';

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationSave.mockClear();

    // Default: token is valid for USER_ID, and the user account is ACTIVE.
    jwt.verify.mockReturnValue({ userId: USER_ID, id: USER_ID });
    UserAccount.findByPk.mockResolvedValue({
      userId: USER_ID,
      accountStatus: 'ACTIVE',
      banReason: null,
      banExpiresAt: null,
      save: jest.fn()
    });

    app = buildApp();
  });

  // ── GET /api/notifications ────────────────────────────────────────────────
  describe('GET /api/notifications', () => {
    it('returns notifications and unreadCount for the authenticated user', async () => {
      const notif = buildNotification();
      InAppNotification.findAll.mockResolvedValue([notif]);
      InAppNotification.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(1);
      expect(res.body.unreadCount).toBe(1);
    });

    it('filters to UNREAD only when ?unreadOnly=true', async () => {
      InAppNotification.findAll.mockResolvedValue([]);
      InAppNotification.count.mockResolvedValue(0);

      await request(app)
        .get('/api/notifications?unreadOnly=true')
        .set('Authorization', TOKEN);

      // The where clause passed to findAll should include notificationReadStatus: 'UNREAD'.
      const findAllCall = InAppNotification.findAll.mock.calls[0][0];
      expect(findAllCall.where.notificationReadStatus).toBe('UNREAD');
    });

    it('does NOT include UNREAD filter when unreadOnly is absent', async () => {
      InAppNotification.findAll.mockResolvedValue([]);
      InAppNotification.count.mockResolvedValue(0);

      await request(app)
        .get('/api/notifications')
        .set('Authorization', TOKEN);

      const findAllCall = InAppNotification.findAll.mock.calls[0][0];
      expect(findAllCall.where.notificationReadStatus).toBeUndefined();
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/notifications/unread-count ──────────────────────────────────
  describe('GET /api/notifications/unread-count', () => {
    it('returns only the integer unreadCount', async () => {
      InAppNotification.count.mockResolvedValue(7);

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(7);
      // Should NOT include full notification rows — lightweight endpoint.
      expect(res.body.notifications).toBeUndefined();
    });
  });

  // ── PATCH /api/notifications/:id/read ────────────────────────────────────
  describe('PATCH /api/notifications/:id/read', () => {
    it('marks the notification as READ and returns 200', async () => {
      const notif = buildNotification({ notificationReadStatus: 'UNREAD' });
      InAppNotification.findOne.mockResolvedValue(notif);

      const res = await request(app)
        .patch(`/api/notifications/${notif.notificationId}/read`)
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
      expect(notif.notificationReadStatus).toBe('READ');
      expect(notif.save).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when notification belongs to a different user (cross-user ownership)', async () => {
      // findOne scopes by recipientUserId — returns null for wrong owner.
      InAppNotification.findOne.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/notifications/other-users-notif-uuid/read')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/notifications/read-all ────────────────────────────────────
  describe('PATCH /api/notifications/read-all', () => {
    it('bulk-updates UNREAD → READ and returns the updated count', async () => {
      InAppNotification.update.mockResolvedValue([5]);

      const res = await request(app)
        .patch('/api/notifications/read-all')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(5);

      // Confirm the update targets the authenticated user's notifications only.
      const updateCall = InAppNotification.update.mock.calls[0];
      expect(updateCall[1].where.recipientUserId).toBe(USER_ID);
      expect(updateCall[1].where.notificationReadStatus).toBe('UNREAD');
    });
  });

  // ── PATCH /api/notifications/:id/dismiss ─────────────────────────────────
  describe('PATCH /api/notifications/:id/dismiss', () => {
    it('sets notificationDismissedStatus to DISMISSED', async () => {
      const notif = buildNotification({ notificationDismissedStatus: 'VISIBLE' });
      InAppNotification.findOne.mockResolvedValue(notif);

      const res = await request(app)
        .patch(`/api/notifications/${notif.notificationId}/dismiss`)
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
      expect(notif.notificationDismissedStatus).toBe('DISMISSED');
      expect(notif.save).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for another user\'s notification (ownership enforced)', async () => {
      InAppNotification.findOne.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/notifications/other-users-notif/dismiss')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(404);
    });
  });

  // ── Cross-cutting: listNotifications scopes by recipientUserId ────────────
  describe('recipientUserId scoping', () => {
    it('passes the authenticated user\'s ID as recipientUserId in all queries', async () => {
      InAppNotification.findAll.mockResolvedValue([]);
      InAppNotification.count.mockResolvedValue(0);

      await request(app)
        .get('/api/notifications')
        .set('Authorization', TOKEN);

      const findAllCall = InAppNotification.findAll.mock.calls[0][0];
      expect(findAllCall.where.recipientUserId).toBe(USER_ID);
    });
  });
});
