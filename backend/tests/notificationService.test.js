/**
 * notificationService.test.js
 * ---------------------------
 * Tests for the centralised notificationService (workstream A).
 *
 * Covers:
 * - createNotification: DB row written, socket event emitted to correct room.
 * - createNotification: graceful degradation when io is not set.
 * - createNotificationsBulk: fan-out and partial failure isolation.
 * - setNotificationIo: io registration is honoured by subsequent calls.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/models', () => ({
  InAppNotification: {
    create: jest.fn().mockResolvedValue({ notificationId: 'test-id' })
  }
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fixed-uuid')
}));

// ── Imports ───────────────────────────────────────────────────────────────────
const { InAppNotification } = require('../src/models');

// Require after mocks are set up.
const {
  setNotificationIo,
  createNotification,
  createNotificationsBulk
} = require('../src/services/notificationService');

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset io to null before each test so tests that set io do not bleed.
    setNotificationIo(null);
  });

  describe('createNotification', () => {
    it('persists an UNREAD notification row with the provided fields', async () => {
      await createNotification({
        recipientUserId: 'user-abc',
        message: 'You have a new update.',
        category: 'NEW_MESSAGE'
      });

      expect(InAppNotification.create).toHaveBeenCalledTimes(1);
      const [row] = InAppNotification.create.mock.calls[0];
      expect(row.recipientUserId).toBe('user-abc');
      expect(row.discreetNotificationMessage).toBe('You have a new update.');
      expect(row.notificationCategoryType).toBe('NEW_MESSAGE');
      expect(row.notificationReadStatus).toBe('UNREAD');
      expect(row.notificationId).toBe('fixed-uuid');
    });

    it('uses REPORT_UPDATE as the default category', async () => {
      await createNotification({ recipientUserId: 'u1', message: 'Update.' });
      const [row] = InAppNotification.create.mock.calls[0];
      expect(row.notificationCategoryType).toBe('REPORT_UPDATE');
    });

    it('emits notification:new to the recipient room when io is set', async () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn(() => ({ emit: mockEmit }));
      const mockIo = { to: mockTo };

      setNotificationIo(mockIo);

      await createNotification({
        recipientUserId: 'user-xyz',
        message: 'Test push.',
        category: 'ASSIGNMENT'
      });

      expect(mockTo).toHaveBeenCalledWith('user:user-xyz');
      expect(mockEmit).toHaveBeenCalledWith('notification:new', expect.objectContaining({
        notificationId: 'fixed-uuid',
        category: 'ASSIGNMENT',
        message: 'Test push.'
      }));
    });

    it('does not throw and still writes to DB when io is null', async () => {
      // io is null (reset in beforeEach) — socket emit should be skipped.
      setNotificationIo(null);

      await expect(
        createNotification({ recipientUserId: 'u2', message: 'Silent update.' })
      ).resolves.not.toThrow();

      expect(InAppNotification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createNotificationsBulk', () => {
    it('fans out to all recipients', async () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn(() => ({ emit: mockEmit }));
      setNotificationIo({ to: mockTo });

      await createNotificationsBulk(['u1', 'u2', 'u3'], 'Bulk message.', 'REPORT_UPDATE');

      expect(InAppNotification.create).toHaveBeenCalledTimes(3);
      expect(mockTo).toHaveBeenCalledTimes(3);
    });

    it('does not throw when one recipient fails', async () => {
      InAppNotification.create
        .mockResolvedValueOnce({ notificationId: 'id-1' })
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ notificationId: 'id-3' });

      await expect(
        createNotificationsBulk(['ok1', 'fail', 'ok3'], 'Partial.', 'MODERATION_ALERT')
      ).resolves.not.toThrow();

      // 3 attempts were made despite one failure.
      expect(InAppNotification.create).toHaveBeenCalledTimes(3);
    });
  });
});
