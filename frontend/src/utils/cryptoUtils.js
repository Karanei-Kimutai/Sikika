/**
 * cryptoUtils.js
 * --------------
 * Client-side cryptographic engine for End-to-End Encryption (E2EE).
 * Uses the native Web Crypto API (AES-GCM). 
 * * NOTE: In a full production app, the shared key is generated via an ECDH 
 * (Elliptic Curve Diffie-Hellman) key exchange. For this implementation, 
 * we derive a deterministic key from the chatId to demonstrate the E2EE flow 
 * where the server remains completely blind to the plaintext.
 */

// Helper: Convert string to ArrayBuffer
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Derives an AES-GCM CryptoKey from a given passphrase (e.g., a shared channel secret).
 */
export const getSharedKey = async (passphrase) => {
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("gbv-platform-secure-salt"), // Fixed salt for demo
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
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
 */
export const decryptMessage = async (encryptedPayload, cryptoKey) => {
  try {
    const { ciphertext, iv } = JSON.parse(encryptedPayload);
    
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