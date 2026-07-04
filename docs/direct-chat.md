# Direct Chat Module

## Overview

The Direct Chat module provides end-to-end encrypted (E2EE) private messaging between a survivor and each of their assigned support staff members (one counsellor and one legal counsel). Messages are encrypted client-side using ECDH key agreement before transmission; the server stores and relays only ciphertext.

For the E2EE cryptography layer specifically, see [`docs/e2ee.md`](./e2ee.md). This document covers channel management, message persistence, delivery tracking, presence, and the archive/trash workflow.

---

## Channel Model

### Channel types

Each survivor has up to two direct-chat channels, provisioned automatically at signup:

| `chatChannelType` | Counterpart |
|---|---|
| `counsellor_channel` | The survivor's assigned counsellor |
| `legal_counsel_channel` | The survivor's assigned legal counsel |

Channels are created by `ensureAutoChannelsForSurvivor` (see below). Survivors cannot create channels manually; channels are driven entirely by assignment.

### Channel statuses

| `chatChannelStatus` | Meaning |
|---|---|
| `active` | Normal state. Both parties can send and receive messages. |
| `archived` | Survivor has archived the channel. Readable (restore possible) but sending is blocked in the socket handler. |
| `deleted` | Survivor has moved to Trash. Inaccessible via `canUserAccessChannel`. Staff never see deleted channels. |

Status transitions:

```
active  ←→  archived
active  →  deleted
archived  →  deleted
deleted  →  active   (survivor restore, not available to staff)
```

Transitions are performed via `PATCH /api/chat/:chatId/status` (REST, not socket).

---

## Channel Provisioning (`chatAccessService.js`)

### `ensureAutoChannelsForSurvivor(survivorProfile)`

Idempotently creates the two standard channels for a survivor. Uses `DirectChatChannel.findOrCreate` so repeated calls are safe — no duplicate channels are created even if called concurrently.

**Called from:**
- `authController.js` — during `complete-signup`, after the survivor's profile and staff assignments are created.
- `chatController.js` — at the top of `GET /api/chat/channels`, so channels appear automatically after an assignment change without requiring a separate provisioning step.

**Input:** A `SurvivorProfile` instance with at least `survivorId`, `assignedCounsellorId`, and `assignedLegalCounselId`.

**Behaviour:** For each assigned staff FK, looks up the staff profile to resolve their `userId` (which becomes `supportStaffCounterpartId` on the channel), then calls `findOrCreate`.

---

## Access Control (`chatAccessService.js`)

### `canUserAccessChannel(userId, chatId)`

The single gating function used by both the REST controller and the socket handler to check whether a user may read or send in a channel.

**Rules:**

| Role | Access condition |
|---|---|
| `SURVIVOR` | `SurvivorProfile.survivorId` must match `DirectChatChannel.survivorId` |
| `COUNSELLOR` / `LEGAL_COUNSEL` | `UserAccount.userId` must match `DirectChatChannel.supportStaffCounterpartId` |
| `NGO_ADMIN` / `MODERATOR` / unknown | Always denied |

Deleted channels (`chatChannelStatus = 'deleted'`) are inaccessible to all roles. Archived channels are readable (to allow survivor restore) but the socket send-path additionally checks for `active` status before persisting a new message.

### `getActorContextByUserId(userId)`

Resolves a user's role and role-specific profile PK in one call. Returns:

```js
{
  userId: string,
  role: 'SURVIVOR'|'COUNSELLOR'|'LEGAL_COUNSEL'|...,
  survivorId: string|null,
  counsellorId: string|null,
  legalCounselId: string|null
}
```

Used internally by `canUserAccessChannel` and can be imported by other services that need the same actor context.

---

## REST API

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/api/chat/channels` | SURVIVOR, COUNSELLOR, LEGAL_COUNSEL | Lists channels for the current user. Calls `ensureAutoChannelsForSurvivor` internally. Response includes `counterpartUserId` for E2EE key lookup. |
| `GET` | `/api/chat/:chatId/messages` | Channel participants | Returns all messages in a channel. Triggers `seenAt` update (mark all as seen). |
| `PATCH` | `/api/chat/:chatId/status` | SURVIVOR (owner only) | Changes channel status (`active`, `archived`, `deleted`). |
| `GET` | `/api/chat/public-key` | All authenticated | Returns the current user's stored ECDH public key (JWK string). |
| `PUT` | `/api/chat/public-key` | All authenticated | Stores or updates the user's ECDH public key. Triggers `chatKey:available` fan-out. |
| `GET` | `/api/chat/:chatId/counterpart-key` | Channel participants | Returns the counterpart's public key for client-side ECDH key agreement. |

### Channel list response shape

```json
[
  {
    "chatId": "uuid",
    "chatChannelType": "counsellor_channel",
    "chatChannelStatus": "active",
    "counterpartUserId": "uuid",
    "supportStaffCounterpart": {
      "userId": "uuid",
      "firstName": "Jane",
      "lastName": "Doe"
    }
  }
]
```

The `counterpartUserId` field is how `DirectChatPage.jsx` knows whose public key to fetch for ECDH.

---

## Message Model (`DirectChatMessage`)

| Column | Type | Description |
|---|---|---|
| `messageId` | `VARCHAR(36) PK` | UUID from `randomUUID()`. |
| `chatId` | `VARCHAR(36) FK` | References `DirectChatChannel.chatId`. |
| `senderUserId` | `VARCHAR(36) FK` | `UserAccount.userId` of the sender. |
| `encryptedMessageContent` | `TEXT` | AES-GCM ciphertext (base64). Server never decrypts this. |
| `messageReadStatus` | ENUM | `'UNREAD'` on creation; `'READ'` after the recipient opens the channel. |
| `deliveredAt` | `DATETIME\|NULL` | Set when the recipient's socket is online at send time, or in bulk on reconnect. |
| `seenAt` | `DATETIME\|NULL` | Set when `GET /api/chat/:chatId/messages` is called by the non-sender. |
| `editedAt` | `DATETIME\|NULL` | Set when the sender edits this message via `editEncryptedMessage`. `NULL` means never edited. No edit history is kept — `encryptedMessageContent` is overwritten in place. |

### Delivery states (shown as ticks in the UI)

```
deliveredAt IS NULL  →  Sent (single tick)
deliveredAt IS NOT NULL, seenAt IS NULL  →  Delivered (double tick)
seenAt IS NOT NULL  →  Seen (blue double tick)
```

---

## Real-Time Messaging (Socket.io)

See [`docs/sockets.md`](./sockets.md) for the full socket architecture. The direct-chat specific flow is:

```
Survivor or staff client
        │
        │  connect(token)
        ▼
chatSocket.js
  → JWT verify, accountStatus check
  → socket.join('user:<userId>')
  → presenceRegistry.markOnline()
  → broadcastPresenceForStaff()    [if first connection]
  → runDeliveryCatchUp()           [if first connection]
        │
        │  emit('joinChannel', chatId)
        ▼
  → canUserAccessChannel() check
  → socket.join(chatId)
        │
        │  emit('sendEncryptedMessage', { chatId, encryptedPayload })
        ▼
  → isUserAccountActive() check
  → canUserAccessChannel() check
  → DirectChatMessage.create({ encryptedMessageContent: encryptedPayload })
  → createDiscreetNotifications()
  → io.to(chatId).emit('receiveMessage', savedMessage)
  → if recipient online: io.to('user:<senderId>').emit('message:delivered', ...)
        │
        │  emit('editEncryptedMessage', { chatId, messageId, encryptedPayload })
        ▼
  → isUserAccountActive() check
  → canUserAccessChannel() check
  → DirectChatMessage.findOne({ messageId, chatId }) — must exist
  → reject unless message.senderUserId === socket.data.userId
  → message.encryptedMessageContent = encryptedPayload; message.editedAt = now
  → io.to(chatId).emit('message:edited', { chatId, messageId, encryptedPayload, editedAt })
```

**Security note:** Account status is checked on **every** `sendEncryptedMessage` and `editEncryptedMessage` event, not just at connection time. A ban applied mid-session takes effect on the next message/edit attempt.

**Editing:** Only the original sender may edit a message — enforced server-side by comparing `senderUserId` to the authenticated socket's `userId`, independent of any client-side UI restriction. The client re-encrypts the edited plaintext under the same shared channel key it already holds and sends the new ciphertext; the server has no way to verify the edit is meaningful since it never sees plaintext. There is no time limit on edits and no edit history — `message:edited` recipients decrypt the new ciphertext and replace the displayed text, tagging it "(edited)" using `editedAt`.

---

## Presence Indicators

Presence in the chat UI reflects whether the support staff member has an active socket connection, layered with their manual `availabilityStatus` DB setting.

| Connectivity | Manual status | Displayed presence |
|---|---|---|
| Connected | `AVAILABLE` or unset | AVAILABLE (green dot) |
| Connected | `BUSY` | BUSY (amber dot) |
| Not connected | _(any)_ | OFFLINE (grey dot) |

The effective presence is computed by `presenceRegistry.getEffectivePresence(userId, manualStatus)`. Socket connectivity always wins — a disconnected staff member always shows OFFLINE regardless of their DB status.

### Presence events

When a staff member's first socket connects or their last disconnects, `broadcastPresenceForStaff` emits `presence:update` to the `user:<survivorUserId>` room for every active channel the staff member has:

```json
{
  "staffUserId": "uuid",
  "chatId": "uuid",
  "presence": "AVAILABLE"
}
```

`DirectChatPage.jsx` listens for this event and updates the presence dot next to the channel header without re-fetching the channel list.

---

## Archive and Trash Workflow

Survivors can archive, delete, and restore their direct-chat channels. Staff members have no access to archived or deleted channels.

### Status transitions (SURVIVOR only)

```
PATCH /api/chat/:chatId/status  body: { status: 'archived' }
PATCH /api/chat/:chatId/status  body: { status: 'deleted'  }
PATCH /api/chat/:chatId/status  body: { status: 'active'   }
```

### Frontend behaviour

`DirectChatPage.jsx` exposes an action menu per channel with Archive, Restore, and Delete options. A "Trash" toggle (`includeDeleted=true` query parameter on `GET /api/chat/channels`) switches the channel list to show only deleted channels so the survivor can restore contact.

### Backend tests

Covered by `backend/tests/chatTrashRestore.test.js` (16 tests) and `e2e/chat-trash-restore.spec.js` (5 E2E tests).

---

## Pending Message Queue

If a counterpart has never logged in, their ECDH public key has not been registered and E2EE key agreement cannot complete. Rather than blocking the composer, unsendable messages are queued locally:

- Messages are stored in `localStorage` per `chatId` by `frontend/src/utils/pendingMessageQueue.js`.
- The queue is drained automatically when the `chatKey:available` Socket.io event fires (emitted by `chatController.js → setPublicKey` when a user registers their key for the first time, fanned out to all counterparts via `getChannelsForParticipant`).
- A 30-second polling fallback also checks for key availability in case the socket event is missed.

See [`docs/e2ee.md`](./e2ee.md) — "Pending-message queue" section — for the cryptographic detail.

---

## Frontend Component (`DirectChatPage.jsx`)

`frontend/src/pages/DirectChatPage.jsx` owns the entire direct-chat user experience:

| Responsibility | Detail |
|---|---|
| Channel list | Fetched on mount via `GET /api/chat/channels`. Active and archived channels shown by default; deleted channels shown only in Trash mode. |
| Message list | Fetched when a channel is selected. Messages are decrypted client-side before display. |
| Composer | Disabled when channel is archived/deleted or when counterpart key is unavailable (pending queue mode). |
| Presence dot | Updated by `presence:update` socket events. |
| Delivery ticks | Sent/Delivered/Seen status derived from `deliveredAt` / `seenAt` on each message. |
| Privacy mask | A "blur overlay" that hides message content until the user interacts — a trauma-informed UX feature. |
| Channel actions | Archive, Restore, Delete via an action menu per channel entry. |
| Socket | Connects on mount, joins the channel room on selection, listens for `receiveMessage`, `message:delivered`, `presence:update`. |

The component derives the counterpart's public key from `counterpartUserId` returned by the channel list, then performs ECDH client-side to get the shared AES-GCM key stored in memory for the session. Private keys are stored in IndexedDB and are non-extractable.

### Channel-switch event queue

Deriving the shared AES-GCM key for a newly-selected channel is asynchronous (network + IndexedDB + ECDH + a one-time history fetch). Socket listener registration is intentionally **decoupled** from that derivation so live events arriving mid-switch are never silently dropped:

- The listener-registration effect keys only on `activeChannelId`/`currentUserId` (not on the derived crypto key), so `receiveMessage`, `presence:update`, `message:delivered`, `message:seen`, and `message:edited` listeners stay attached across a channel switch instead of being torn down and re-attached once the key is ready.
- The two handlers that need to decrypt (`handleNewMessage`, `handleMessageEdited`) check a ref-mirrored copy of the crypto key (`effectiveCryptoKeyRef`); if it isn't ready yet they push the raw event onto `pendingSocketEventsRef` instead of decrypting immediately.
- A separate effect, keyed on the crypto key becoming available, drains `pendingSocketEventsRef` in arrival order and replays each event through its handler now that decryption is possible, then clears the queue.
- `presence:update`/`message:delivered`/`message:seen` don't decrypt anything, so they're applied immediately regardless of key readiness — only the two decrypting handlers use the queue.

Net effect: switching channels while the counterpart is actively sending a message no longer loses that message — it's buffered and replayed once the new channel's key is derived, instead of arriving while the listener is unregistered.

---

## Cloudinary Integration (Evidence)

Direct chat itself does not handle file uploads. Evidence files submitted alongside incident reports are uploaded via `POST /api/reports/:reportId/evidence` (multipart) and stored in Cloudinary with `type: authenticated`. They are served back via a backend streaming proxy at `GET /api/reports/:reportId/evidence/:evidenceId/file` — Cloudinary URLs never reach the browser. See [`docs/e2ee.md`](./e2ee.md) and the main `CLAUDE.md` Cloudinary section for more detail.
