# End-to-End Encryption (Direct Chat)

This document covers how E2EE works for direct chat between a survivor and their assigned counsellor/legal counsel — what it protects against, how the cryptography works, how it's implemented across the backend and frontend, and how to test it locally.

---

## What E2EE means here

"End-to-end encrypted" means the plaintext of a message exists only on the two participants' devices. The server stores and relays ciphertext (`directChatChannel`/`directChatMessage.encryptedMessageContent`) without ever being able to decrypt it — even with full database access, full server compromise, or a legal order compelling disclosure of stored data.

This matters specifically for a GBV survivor-support platform: a survivor's account of abuse, plans, or safety arrangements should not be readable to anyone who manages to read the database, including a malicious insider or a compromised cloud provider.

## Threat model

**Protected against:**
- Passive network inspection (TLS already covers this, but E2EE means even a TLS-terminating proxy or load balancer sees only ciphertext at the application layer).
- Database compromise / dump — `directChatMessage.encryptedMessageContent` is unreadable without a participant's private key, which is never transmitted or stored server-side.
- A subpoena or internal request for "what did this user say" — the operator literally cannot produce plaintext.

**Not protected against (known, accepted limitations for this project's scope):**
- **No safety-number / fingerprint verification.** Real E2EE systems (Signal, WhatsApp) let users manually verify their counterpart's public key out-of-band, so a compromised server can't quietly substitute its own key during the exchange and silently MITM the conversation. This platform doesn't have that step — the server is trusted *not to act maliciously during key exchange*, even though it's no longer trusted with plaintext.
- **No multi-device support.** A user's private key lives in exactly one browser's IndexedDB. Logging in from a second device/browser generates a *new* keypair; old conversations encrypted under the first device's key become unreadable from the second device. The server is updated with the new public key, which means the first device's sessions can no longer decrypt new messages either until that device re-derives the shared key using the counterpart's updated public key on next load. In practice: **switching devices breaks decryption of old messages**. This is an explicit demo-scope decision.
- **Key loss = history loss.** Clearing browser data, switching browsers, using private/incognito mode (which discards IndexedDB on close), or OS reinstallation loses the private key permanently — there is no backup, recovery, or cloud sync mechanism. Users should treat their browser profile as their "device" and avoid clearing site data. This is an explicit dev/demo-scope tradeoff, not an oversight.
- **XSS is a full key compromise.** Private keys are stored non-extractable in IndexedDB — there is no JavaScript API to export the raw key bytes. However, IndexedDB is origin-scoped, not XSS-scoped: an XSS payload running on this origin can call `crypto.subtle.decrypt` with the stored key and decrypt any message it chooses, or post arbitrary ciphertext through the signing key. The non-extractable flag stops a *passive* dump of the key material, but does not stop an *active* attacker who can run code. The practical mitigation is a robust Content-Security-Policy and rigorous input sanitisation — XSS prevention is the prerequisite for E2EE to mean anything at the browser layer.
- **No per-identity storage isolation within one browser profile.** Keypairs are stored in IndexedDB keyed by `userId` (see `keyStorage.js`), so two different users logged in via two tabs of the same browser profile each get their own row rather than colliding — useful for local testing. But IndexedDB is origin-scoped, not identity-scoped: any script running on this origin (e.g. an XSS payload) could invoke the crypto operations for *any* stored user's key, not just the currently active one. Separate devices/browser profiles are the only real isolation boundary in production use.

## How it works conceptually

Two cryptographic primitives are combined:

1. **ECDH (Elliptic Curve Diffie-Hellman), curve P-256** — a key *agreement* algorithm. Each participant generates a keypair (private + public). Given your own private key and the other party's public key, you can compute a shared secret that only the two of you can derive — without ever transmitting that secret. Critically, the server only ever sees the *public* keys, which by design reveal nothing about the shared secret.
2. **AES-GCM, 256-bit** — the actual message *encryption*. The ECDH-derived shared secret becomes the AES-GCM key for that pair. Each message gets a fresh random IV, so two messages with identical plaintext never produce identical ciphertext.

This is a meaningful upgrade over the platform's original design, where the AES key was derived (via PBKDF2) from the `chatId` itself — a value the server already knows, so the server could always have re-derived the key. With ECDH, the server never possesses (and cannot derive) either party's private key, so it cannot reconstruct the shared secret.

## Implementation

### Backend

| Piece | File |
|---|---|
| `userAccount.ecdhPublicKey` (`TEXT('long')`, nullable) | `backend/src/models/userAccount.js` |
| `GET /api/chat/public-key/:userId` — fetch a user's public key | `backend/src/controllers/chatController.js` (`getPublicKey`) |
| `PUT /api/chat/public-key` — register the caller's own public key | `backend/src/controllers/chatController.js` (`setPublicKey`) |
| `counterpartUserId` field added to `getChannels` response | `backend/src/controllers/chatController.js` (`getChannels`) |

Only the **public** key is ever stored server-side. Both endpoints require authentication (`authMiddleware`), but `getPublicKey` has no further restriction on *whose* key can be looked up — public keys aren't sensitive by design, and UUIDs already prevent enumeration, so this mirrors how real key-distribution servers (e.g. Signal's) behave.

`getChannels` previously gave each side of a channel only a *partial* view of the other participant's identity: the survivor side has `supportStaffCounterpartId` (a `UserAccount.userId`) directly on the channel, but the staff side only has `survivorId` (a `SurvivorProfile` primary key, not a `UserAccount.userId`). The enriched response now resolves both sides to a single `counterpartUserId` field so the frontend always knows which user's public key to fetch.

`backend/src/sockets/chatSocket.js` is unchanged — it already relays opaque `encryptedMessageContent` without server-side decryption, regardless of which key-agreement scheme produced it.

### Frontend

| Piece | File |
|---|---|
| IndexedDB keypair storage (generate/persist/retrieve, per `userId`) | `frontend/src/utils/keyStorage.js` |
| `exportPublicKeyJwk`, `deriveSharedKey`, `encryptMessage`, `decryptMessage` | `frontend/src/utils/cryptoUtils.js` |
| `fetchPublicKey`, `registerPublicKey` (service layer) | `frontend/src/services/chatKeys.js` |
| Keypair bootstrap on every authenticated app load | `frontend/src/App.jsx` |
| Per-channel key derivation when a chat is opened | `frontend/src/pages/DirectChatPage.jsx` |

The private key is generated **non-extractable** (`crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])`) — there is no code path, by construction, that can export it once created. It's persisted in IndexedDB (not `sessionStorage`, which is tab-scoped and cleared on tab close — the private key needs to survive page refreshes within a session).

### End-to-end flow

1. **Login (or page refresh while authenticated)** — `App.jsx` calls `getOrCreateKeyPair(userId)`. If this browser has no stored keypair for this user, one is generated; otherwise the existing one is loaded from IndexedDB. The public key is exported as a JWK string and `PUT` to `/api/chat/public-key` (idempotent — safe on every load).
2. **Opening a direct-chat channel** — `DirectChatPage.jsx` looks up the active channel's `counterpartUserId` (from the channel list already in component state), then `GET`s that user's public key via `fetchPublicKey`.
3. **Key derivation** — with the local private key and the counterpart's public key, `deriveSharedKey` runs `crypto.subtle.deriveKey({ name: 'ECDH', public: peerPublicKey }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])`. Both participants independently compute the *same* AES-GCM key.
4. **Sending/receiving** — `encryptMessage`/`decryptMessage` are unchanged from before; they only need an AES-GCM `CryptoKey`, regardless of how it was derived.

If a counterpart hasn't ever loaded the app to register a public key (most commonly: a newly-provisioned staff account, or a survivor's just-assigned counsellor/legal counsel who hasn't logged in yet), `fetchPublicKey` returns `null`. Rather than blocking the composer, the chat shows a non-blocking banner and lets the user keep typing — see "Pending-message queue" below.

### Pending-message queue (composing before the counterpart's key exists)

Messages typed while the counterpart's public key isn't registered yet are held client-side in `localStorage` (`frontend/src/utils/pendingMessageQueue.js`, keyed per `chatId`) as plaintext — never transmitted, since there's no key yet to encrypt under. This doesn't weaken the threat model: same-origin XSS already had access to the IndexedDB-stored private key, so a queued plaintext message in `localStorage` adds no new exposure beyond what was already possible.

The composer stays enabled in this state (`DirectChatPage.jsx`), and the message renders with a "Pending" tag instead of the normal delivery ticks. Once the counterpart registers their public key — either pushed in real time via the `chatKey:available` Socket.io event (`backend/src/controllers/chatController.js` `setPublicKey` notifies every channel counterpart after a successful key registration) or picked up by a 30s polling fallback — the queued messages are encrypted and sent automatically, in order, exactly as a normal send would be.

## Seeded/legacy plaintext passthrough

`decryptMessage` (`frontend/src/utils/cryptoUtils.js`) first checks that the stored payload is a valid `{ ciphertext, iv }` JSON envelope. Anything else is returned verbatim as display text. This exists for seeded demo conversations: the seeder cannot produce real ciphertext (private keys are non-extractable and never leave each user's browser), so it stores demo transcripts as plaintext, and this display-only fallback renders them readably. Real messages always carry the envelope and always go through AES-GCM — the passthrough never applies to them, and a genuine decryption failure still renders the unreadable marker below.

## Migration note

Switching key-derivation schemes means any message ciphertext encrypted under the old PBKDF2-from-`chatId` key can no longer be decrypted with the new ECDH-derived key — `decryptMessage` already degrades gracefully to `"[Encrypted Message - Unreadable]"` rather than throwing. For local development, reseed for a clean slate:

```bash
cd backend && node src/seeders/index.js
```

## Testing locally

Two tabs of the same browser profile work fine — keypairs are keyed by `userId` in IndexedDB, so two different logged-in identities don't collide. Two separate browser profiles (or one normal + one incognito/private window) work too, and better reflect production (two separate devices), since each gets a fully separate IndexedDB store.

1. Reseed the dev database (see above) and start both servers (`npm run dev` in `backend/` and `frontend/`).
2. In tab/window A, sign in as the demo Survivor (`+254711000001` / `Survivor@2026!`).
3. In tab/window B, sign in as the demo Counsellor (`+254700000020` / `Counsellor@2026!`).
4. Open the shared direct-chat channel in both and exchange a few messages — they should render as plaintext on both sides immediately.
5. Optionally inspect `userAccount.ecdhPublicKey` for both rows (populated shortly after login) and `directChatMessage.encryptedMessageContent` (ciphertext, unreadable without the private keys) to confirm the server-side data is opaque.
6. Refresh one of the windows mid-session — the channel should still decrypt without re-logging in, confirming the private key persisted in IndexedDB.

Backend coverage: `backend/tests/chatPublicKey.test.js` covers auth requirements, validation, and persistence for both public-key endpoints.
