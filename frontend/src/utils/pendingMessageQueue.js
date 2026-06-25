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

const KEY_PREFIX = 'pendingMessages:';

/** @returns {Array<{ localId: string, plaintext: string, createdAt: string }>} */
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

function savePending(chatId, entries) {
  localStorage.setItem(`${KEY_PREFIX}${chatId}`, JSON.stringify(entries));
}

/**
 * Appends a plaintext message to the channel's pending queue.
 * @returns {{ localId: string, plaintext: string, createdAt: string }} the queued entry
 */
export function enqueuePending(chatId, plaintext) {
  const entry = { localId: crypto.randomUUID(), plaintext, createdAt: new Date().toISOString() };
  savePending(chatId, [...getPending(chatId), entry]);
  return entry;
}

/** Removes a single queued entry by localId once it has been sent. */
export function removePending(chatId, localId) {
  savePending(chatId, getPending(chatId).filter((entry) => entry.localId !== localId));
}
