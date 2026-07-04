/**
 * socketAuthService.test.js
 * --------------------------
 * Unit tests for the shared Socket.io auth helpers extracted so both
 * chatSocket.js and communitySocket.js can enforce the same mid-session
 * accountStatus recheck (see backend/src/services/socketAuthService.js).
 */

jest.mock('../src/models', () => ({
  UserAccount: {
    findByPk: jest.fn()
  }
}));

const { UserAccount } = require('../src/models');
const {
  getTokenFromHandshake,
  resolveUserIdFromTokenClaims,
  isUserAccountActive
} = require('../src/services/socketAuthService');

describe('getTokenFromHandshake', () => {
  it('prefers the auth.token field when present', () => {
    const socket = { handshake: { auth: { token: 'from-auth' }, headers: {} } };
    expect(getTokenFromHandshake(socket)).toBe('from-auth');
  });

  it('falls back to the Authorization header when auth.token is absent', () => {
    const socket = { handshake: { auth: {}, headers: { authorization: 'Bearer from-header' } } };
    expect(getTokenFromHandshake(socket)).toBe('from-header');
  });

  it('returns null when neither source provides a token', () => {
    const socket = { handshake: { auth: {}, headers: {} } };
    expect(getTokenFromHandshake(socket)).toBeNull();
  });

  it('returns null when the Authorization header is present but not a Bearer token', () => {
    const socket = { handshake: { auth: {}, headers: { authorization: 'Basic abc123' } } };
    expect(getTokenFromHandshake(socket)).toBeNull();
  });
});

describe('resolveUserIdFromTokenClaims', () => {
  it('resolves the current userId claim', () => {
    expect(resolveUserIdFromTokenClaims({ userId: 'user-1' })).toBe('user-1');
  });

  it('falls back to the legacy id claim', () => {
    expect(resolveUserIdFromTokenClaims({ id: 'user-2' })).toBe('user-2');
  });

  it('returns null when neither claim is present', () => {
    expect(resolveUserIdFromTokenClaims({})).toBeNull();
  });

  it('returns null for null/undefined claims', () => {
    expect(resolveUserIdFromTokenClaims(null)).toBeNull();
  });
});

describe('isUserAccountActive', () => {
  beforeEach(() => {
    UserAccount.findByPk.mockReset();
  });

  it('returns true for an ACTIVE account', async () => {
    UserAccount.findByPk.mockResolvedValue({ accountStatus: 'ACTIVE' });
    await expect(isUserAccountActive('user-1')).resolves.toBe(true);
  });

  it('returns false for a BANNED account', async () => {
    UserAccount.findByPk.mockResolvedValue({ accountStatus: 'BANNED' });
    await expect(isUserAccountActive('user-1')).resolves.toBe(false);
  });

  it('returns false for a SUSPENDED account', async () => {
    UserAccount.findByPk.mockResolvedValue({ accountStatus: 'SUSPENDED' });
    await expect(isUserAccountActive('user-1')).resolves.toBe(false);
  });

  it('returns a falsy value when the account no longer exists', async () => {
    // Short-circuits on `user && ...`, so this resolves to null rather than
    // strictly false — falsy either way for the socket handlers' `if (!stillActive)` checks.
    UserAccount.findByPk.mockResolvedValue(null);
    await expect(isUserAccountActive('user-1')).resolves.toBeFalsy();
  });

  it('fails closed (returns false) when the DB lookup throws', async () => {
    UserAccount.findByPk.mockRejectedValue(new Error('connection lost'));
    await expect(isUserAccountActive('user-1')).resolves.toBe(false);
  });
});
