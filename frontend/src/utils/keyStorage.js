/**
 * keyStorage.js
 * -------------
 * Persists each user's ECDH (P-256) keypair in IndexedDB, scoped by userId.
 *
 * The private key is generated non-extractable, so it can never leave this
 * browser profile once created (no export path exists) — this is the root
 * of the E2EE guarantee for direct chat. IndexedDB (not sessionStorage) is
 * used because the key must survive page refreshes within a session.
 *
 * Records are keyed by userId, so multiple identities' keypairs can coexist
 * in one IndexedDB store without colliding — e.g. two tabs of the same
 * browser profile logged in as different users will each get their own
 * row and can hold a real E2EE conversation. The tradeoff: IndexedDB is
 * origin-scoped, not per-identity-scoped, so any script running on this
 * origin (e.g. an XSS payload) could read *any* stored user's private key,
 * not just the currently logged-in one. Separate devices/browser profiles
 * remain the only real isolation boundary; this is a convenience for local
 * testing, not a security guarantee.
 */

const DB_NAME = 'sikika-e2ee';
const DB_VERSION = 1;
const STORE_NAME = 'keypairs';

/** Opens (and lazily creates) the IndexedDB database used for keypair storage. */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Reads a stored keypair record for a userId, or null if none exists. */
async function readKeyPair(userId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/** Writes a keypair record for a userId. */
async function writeKeyPair(userId, privateKey, publicKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ userId, privateKey, publicKey });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Deletes a stored keypair record for a userId, if present. */
export async function deleteKeyPair(userId) {
  if (!userId) return;

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(userId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns this browser's ECDH keypair for the given userId, generating and
 * persisting one on first call. Safe to call repeatedly (idempotent).
 *
 * @param {string} userId
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey }>}
 */
export async function getOrCreateKeyPair(userId) {
  const existing = await readKeyPair(userId);
  if (existing) {
    return { privateKey: existing.privateKey, publicKey: existing.publicKey };
  }

  // Private key is non-extractable — it can be used to derive shared secrets
  // but never read or exported out of this browser.
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );

  await writeKeyPair(userId, keyPair.privateKey, keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}
