/**
 * pendingMessageQueue.js
 * -----------------------
 * Holds outgoing direct-chat plaintext locally, per channel, while the
 * counterpart's ECDH public key hasn't been registered yet (e.g. they have
 * never logged in to generate one — see docs/e2ee.md). Messages stay queued
 * here, never transmitted, until a shared AES-GCM key can be derived, at
 * which point DirectChatPage.jsx encrypts and sends them in order.
 *
 * Uses localStorage (not IndexedDB, which is reserved for the non-extractable
 * private key in keyStorage.js) — this queue only ever holds plaintext that
 * the user themselves typed, so it carries no additional key-material risk.
 */

/** localStorage key prefix; combined with chatId to form a per-channel key. */
const KEY_PREFIX = 'pendingMessages:';

/**
 * Returns all pending (unsent) messages for a channel, ordered by insertion.
 * Returns an empty array when no queue exists or the stored JSON is corrupt.
 *
 * @param {string} chatId - DirectChatChannel.chatId.
 * @returns {Array<{ localId: string, plaintext: string, createdAt: string }>}
 */
export function getPending(chatId) {
  if (!chatId) return [];
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${chatId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists the full pending-message array for a channel.
 * @param {string} chatId - DirectChatChannel.chatId.
 * @param {Array<{ localId: string, plaintext: string, createdAt: string }>} entries
 * @returns {void}
 */
function savePending(chatId, entries) {
  localStorage.setItem(`${KEY_PREFIX}${chatId}`, JSON.stringify(entries));
}

/**
 * Appends a plaintext message to the channel's pending queue.
 * The assigned `localId` (UUID) is returned so the caller can match the entry
 * when calling `removePending` after the message is successfully encrypted and sent.
 *
 * @param {string} chatId - DirectChatChannel.chatId.
 * @param {string} plaintext - Raw message text typed by the user.
 * @returns {{ localId: string, plaintext: string, createdAt: string }} The queued entry.
 */
export function enqueuePending(chatId, plaintext) {
  const entry = { localId: crypto.randomUUID(), plaintext, createdAt: new Date().toISOString() };
  savePending(chatId, [...getPending(chatId), entry]);
  return entry;
}

/**
 * Removes a single queued entry by its `localId` once the message has been
 * successfully encrypted and sent via Socket.io.
 *
 * @param {string} chatId - DirectChatChannel.chatId.
 * @param {string} localId - The UUID assigned by `enqueuePending`.
 * @returns {void}
 */
export function removePending(chatId, localId) {
  savePending(chatId, getPending(chatId).filter((entry) => entry.localId !== localId));
}

/**
 * Deletes every channel's pending-message queue from localStorage.
 * Called on sign-out and Quick Exit so queued plaintext never outlives the
 * session that typed it, regardless of whether it was ever encrypted/sent.
 *
 * @returns {void}
 */
export function purgeAllPending() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith(KEY_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
}
