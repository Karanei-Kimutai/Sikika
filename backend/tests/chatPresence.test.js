/**
 * chatPresence.test.js
 * --------------------
 * Unit tests for the presence registry and chat-controller presence integration.
 *
 * Covered:
 * 1. presenceRegistry — markOnline / markOffline / isOnline / getEffectivePresence
 * 2. chatController.markChannelRead — sets seenAt on newly-read messages
 */

const { markOnline, markOffline, isOnline, getEffectivePresence } = require('../src/services/presenceRegistry');

// ────────────────────────────────────────────────────────────────────────────
// 1. presenceRegistry unit tests
// ────────────────────────────────────────────────────────────────────────────

describe('presenceRegistry', () => {
  // Each test gets a clean registry state by using distinct userId strings.
  // (Registry is a module-level Map; tests use unique IDs to avoid collisions.)

  describe('markOnline / isOnline', () => {
    it('marks a user online and returns true (just came online)', () => {
      const justCameOnline = markOnline('user-1', 'socket-A');
      expect(justCameOnline).toBe(true);
      expect(isOnline('user-1')).toBe(true);
    });

    it('returns false when the user already had a connection (second tab)', () => {
      markOnline('user-2', 'socket-B');
      const justCameOnline = markOnline('user-2', 'socket-C');
      expect(justCameOnline).toBe(false); // already online from socket-B
      expect(isOnline('user-2')).toBe(true);
    });
  });

  describe('markOffline / isOnline', () => {
    it('marks a user offline when their last socket disconnects', () => {
      markOnline('user-3', 'socket-D');
      const wentOffline = markOffline('user-3', 'socket-D');
      expect(wentOffline).toBe(true);
      expect(isOnline('user-3')).toBe(false);
    });

    it('returns false when the user still has other open sockets', () => {
      markOnline('user-4', 'socket-E');
      markOnline('user-4', 'socket-F');
      const wentOffline = markOffline('user-4', 'socket-E');
      expect(wentOffline).toBe(false); // socket-F still open
      expect(isOnline('user-4')).toBe(true);
    });

    it('returns false when the user was never tracked', () => {
      const wentOffline = markOffline('user-unknown', 'socket-X');
      expect(wentOffline).toBe(false);
    });
  });

  describe('getEffectivePresence', () => {
    it('returns OFFLINE when the user is not connected regardless of manual status', () => {
      // Ensure this userId is not registered
      expect(getEffectivePresence('user-offline', 'AVAILABLE')).toBe('OFFLINE');
      expect(getEffectivePresence('user-offline', 'BUSY')).toBe('OFFLINE');
      expect(getEffectivePresence('user-offline', null)).toBe('OFFLINE');
    });

    it('returns BUSY when connected and manual status is BUSY', () => {
      markOnline('user-busy', 'socket-G');
      expect(getEffectivePresence('user-busy', 'BUSY')).toBe('BUSY');
    });

    it('returns AVAILABLE when connected and manual status is AVAILABLE', () => {
      markOnline('user-avail', 'socket-H');
      expect(getEffectivePresence('user-avail', 'AVAILABLE')).toBe('AVAILABLE');
    });

    it('returns AVAILABLE when connected and manual status is OFFLINE (connectivity wins)', () => {
      // Staff might have left their status as OFFLINE in the DB but actually reconnected.
      // Real connectivity is the authoritative signal.
      markOnline('user-weird', 'socket-I');
      expect(getEffectivePresence('user-weird', 'OFFLINE')).toBe('AVAILABLE');
    });

    it('returns OFFLINE after the user disconnects their last socket', () => {
      markOnline('user-disc', 'socket-J');
      markOffline('user-disc', 'socket-J');
      expect(getEffectivePresence('user-disc', 'AVAILABLE')).toBe('OFFLINE');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. markChannelRead seenAt integration (controller-level, mocked models)
// ────────────────────────────────────────────────────────────────────────────

// We mock the Sequelize models and canUserAccessChannel to avoid a DB connection.
// The test validates that markChannelRead:
//  a) passes the correct WHERE clause to findAll
//  b) sets seenAt alongside messageReadStatus when updating
//  c) emits message:seen over io

jest.mock('../src/services/chatAccessService', () => ({
  getActorContextByUserId: jest.fn(),
  ensureAutoChannelsForSurvivor: jest.fn(),
  canUserAccessChannel: jest.fn().mockResolvedValue(true)
}));

const FAKE_MESSAGE_ID = 'fake-msg-1';
const FAKE_SENDER_ID = 'sender-user';
const FAKE_CHAT_ID = 'chat-abc';

// Build a minimal model mock
const fakeMessages = [{ messageId: FAKE_MESSAGE_ID, senderUserId: FAKE_SENDER_ID }];
const mockFindAll = jest.fn().mockResolvedValue(fakeMessages);
const mockUpdate = jest.fn().mockResolvedValue([1]);

jest.mock('../src/models', () => ({
  DirectChatChannel: { findAll: jest.fn(), findByPk: jest.fn() },
  DirectChatMessage: {
    findAll: mockFindAll,
    update: mockUpdate,
    count: jest.fn().mockResolvedValue(0)
  },
  SurvivorProfile: { findOne: jest.fn().mockResolvedValue(null) },
  UserAccount: { findByPk: jest.fn() },
  CounsellorProfile: { findAll: jest.fn().mockResolvedValue([]) },
  LegalCounselProfile: { findAll: jest.fn().mockResolvedValue([]) }
}));

// Require the controller AFTER mocking models
const { markChannelRead } = require('../src/controllers/chatController');

describe('chatController.markChannelRead', () => {
  let mockReq, mockRes, mockIo;

  beforeEach(() => {
    jest.clearAllMocks();

    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };

    mockReq = {
      params: { chatId: FAKE_CHAT_ID },
      user: { userId: 'reader-user' },
      app: { locals: { io: mockIo } }
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    // Reset mock to return the fake messages list
    mockFindAll.mockResolvedValue(fakeMessages);
    mockUpdate.mockResolvedValue([1]);
  });

  it('sets seenAt when marking messages read', async () => {
    await markChannelRead(mockReq, mockRes);

    // update() should have been called with seenAt set
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ messageReadStatus: 'READ', seenAt: expect.any(Date) }),
      expect.any(Object)
    );
  });

  it('emits message:seen event to the channel room', async () => {
    await markChannelRead(mockReq, mockRes);

    expect(mockIo.to).toHaveBeenCalledWith(FAKE_CHAT_ID);
    expect(mockIo.emit).toHaveBeenCalledWith(
      'message:seen',
      expect.objectContaining({
        chatId: FAKE_CHAT_ID,
        messageIds: [FAKE_MESSAGE_ID],
        seenAt: expect.any(Date)
      })
    );
  });

  it('also emits to the original sender\'s personal room', async () => {
    await markChannelRead(mockReq, mockRes);

    expect(mockIo.to).toHaveBeenCalledWith(`user:${FAKE_SENDER_ID}`);
  });

  it('returns 200 JSON success', async () => {
    await markChannelRead(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Messages marked as read.' });
  });

  it('does not call update or emit when there are no unread messages', async () => {
    mockFindAll.mockResolvedValue([]);

    await markChannelRead(mockReq, mockRes);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Messages marked as read.' });
  });
});
