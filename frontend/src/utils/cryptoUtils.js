/**
 * cryptoUtils.js
 * --------------
 * Client-side cryptographic engine for End-to-End Encryption (E2EE).
 * Uses the native Web Crypto API: ECDH (P-256) for key agreement and
 * AES-GCM for message encryption. Each user's private key is generated
 * non-extractable and stored only in this browser's IndexedDB (see
 * keyStorage.js) — the server only ever sees public keys and ciphertext.
 * See docs/e2ee.md for the full design and threat model.
 */

// Helper: Convert string to ArrayBuffer
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Exports a public CryptoKey as a JWK JSON string for upload to the server.
 */
export const exportPublicKeyJwk = async (publicKey) => {
  const jwk = await window.crypto.subtle.exportKey("jwk", publicKey);
  return JSON.stringify(jwk);
};

/**
 * Derives the shared AES-GCM channel key via ECDH from this user's private
 * key and the counterpart's public key (as a JWK JSON string).
 */
export const deriveSharedKey = async (privateKey, peerPublicKeyJwk) => {
  const peerPublicKey = await window.crypto.subtle.importKey(
    "jwk",
    JSON.parse(peerPublicKeyJwk),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  return window.crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

/**
 * Encrypts plaintext into a Base64 ciphertext string and its IV.
 */
export const encryptMessage = async (plaintext, cryptoKey) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    cryptoKey,
    enc.encode(plaintext)
  );

  // Convert buffers to Base64 for database storage
  const ciphertextB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
  const ivB64 = btoa(String.fromCharCode(...iv));

  return JSON.stringify({ ciphertext: ciphertextB64, iv: ivB64 });
};

/**
 * Decrypts a stored Base64 payload back into plaintext.
 *
 * Payloads that are not a valid `{ ciphertext, iv }` envelope are returned
 * verbatim: seeded/legacy demo messages are stored as plaintext (the seeder
 * cannot produce real ciphertext — private keys never leave each browser),
 * and this display-only passthrough lets them render as readable text.
 * Real messages always carry the envelope and still go through AES-GCM;
 * a genuine decryption failure keeps the unreadable marker.
 */
export const decryptMessage = async (encryptedPayload, cryptoKey) => {
  // Plaintext passthrough: anything that isn't the {ciphertext, iv} envelope
  // is seeded/legacy plaintext, not ciphertext — show it as-is.
  let envelope;
  try {
    envelope = JSON.parse(encryptedPayload);
  } catch {
    return encryptedPayload;
  }
  if (
    !envelope ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.iv !== "string"
  ) {
    return encryptedPayload;
  }

  try {
    const { ciphertext, iv } = envelope;

    const ciphertextBuffer = new Uint8Array(atob(ciphertext).split("").map(c => c.charCodeAt(0)));
    const ivBuffer = new Uint8Array(atob(iv).split("").map(c => c.charCodeAt(0)));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuffer },
      cryptoKey,
      ciphertextBuffer
    );

    return dec.decode(decryptedBuffer);
  } catch {
    console.error("Decryption failed. Invalid key or corrupted payload.");
    return "[Encrypted Message - Unreadable]";
  }
};