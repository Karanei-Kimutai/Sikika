# Socket.io Architecture Reference

## Overview

The Sikika platform uses Socket.io for three real-time communication channels mounted on the same server instance: direct (private) chat, community rooms, and notification push. All three share a single Socket.io server (`io`) created in `backend/index.js`, but are logically separated by room naming conventions and event namespaces.

There is no dedicated Socket.io namespace (`/chat`, `/community`, etc.) — everything runs on the default namespace (`/`). Separation is achieved through:

- **Room prefixes** — `community-room:<roomId>`, `community-moderation`, `user:<userId>`, and bare `<chatId>` for direct channels.
- **Handler modules** — `chatSocket.js` and `communitySocket.js` each register listeners on the shared `io.on('connection')` event. Both run for every connection but gate their behaviour on JWT claims and channel membership.

---

## Authentication Model

Every WebSocket connection must carry a valid JWT. Both socket handlers extract the token using the same helper pattern:

1. `socket.handshake.auth.token` (preferred — set by socket.io-client `auth` option)
2. `Authorization: Bearer <token>` HTTP upgrade header (fallback for non-browser clients)

If no token is present or the JWT signature is invalid, the connection is **disconnected immediately** — no events are emitted except a single `messageError` (in the direct chat handler).

### Account status re-check

JWTs are long-lived. To enforce bans and suspensions applied after token issuance, both handlers query `UserAccount.accountStatus` from the database at connection time and reject any account that is not `ACTIVE`.

`chatSocket.js` additionally re-checks `accountStatus` on **every `sendEncryptedMessage` event** (not just connection) so a ban applied mid-session takes effect on the next message attempt without requiring a reconnect.

---

## Socket Handlers

### chatSocket.js (`backend/src/sockets/chatSocket.js`)

Handles private direct-chat between a survivor and a support staff member.

**Connection lifecycle:**

| Step | What happens |
|---|---|
| Token extracted from handshake | `getTokenFromHandshake(socket)` |
| JWT verified | `jwt.verify(token, JWT_SECRET)` |
| `userId` resolved | Handles both `id` and `userId` claim names |
| `accountStatus` queried | `isUserAccountActive(userId)` — fails closed |
| Socket joins personal room | `socket.join('user:<userId>')` |
| Presence marked online | `presenceRegistry.markOnline(userId, socket.id)` |
| If first connection: broadcast presence to survivors | `broadcastPresenceForStaff(io, userId, manualStatus)` |
| If first connection: delivery catch-up | `runDeliveryCatchUp(io, userId)` |

**Client → Server events:**

| Event | Payload | Description |
|---|---|---|
| `joinChannel` | `chatId: string` | Joins the socket.io room for a specific direct-chat channel. Membership is verified via `canUserAccessChannel` before the join is accepted. |
| `sendEncryptedMessage` | `{ chatId, encryptedPayload }` | Persists an encrypted message and broadcasts it to the channel room. Account status and channel access are re-checked on every call. The server stores and relays only ciphertext — plaintext is never seen. |
| `editEncryptedMessage` | `{ chatId, messageId, encryptedPayload }` | Overwrites an existing message's ciphertext and sets `editedAt`. Only the original sender may edit (checked server-side against `senderUserId`); rejected with `messageError` otherwise. No edit history is kept. |

**Server → Client events:**

| Event | Payload | Description |
|---|---|---|
| `receiveMessage` | Saved `DirectChatMessage` row | Broadcast to everyone in the `chatId` room when a new message is persisted. |
| `message:delivered` | `{ chatId, messageIds[], deliveredAt }` | Sent to the channel room and the sender's personal `user:<userId>` room when delivery is confirmed. |
| `message:edited` | `{ chatId, messageId, encryptedPayload, editedAt }` | Broadcast to the channel room when a message is edited. Clients decrypt the new ciphertext and replace the displayed text. |
| `presence:update` | `{ staffUserId, chatId, presence }` | Sent to a survivor's `user:<userId>` room when their staff member's online/offline status changes. |
| `messageError` | `{ error: string }` | Sent to the emitting socket when auth fails, channel access is denied, or a message cannot be saved. |

**Delivery confirmation logic:**

When a message is saved, the handler checks `presenceRegistry.isOnline(recipientUserId)`. If the recipient is currently connected, `deliveredAt` is set immediately on the new `DirectChatMessage` row and a `message:delivered` event is emitted. If the recipient is offline, `deliveredAt` stays `null` and is set in bulk the next time they connect via `runDeliveryCatchUp`.

**Notifications:**

Every new message triggers `createDiscreetNotifications` which calls `createNotificationsBulk` to create a privacy-safe in-app notification ("You have a new update.") for all channel participants except the sender. This also pushes a real-time `notification:new` event to their personal socket rooms.

---

### communitySocket.js (`backend/src/sockets/communitySocket.js`)

Handles real-time subscription to community room broadcasts and the moderation feed. Unlike `chatSocket.js`, this handler does **not** register a personal `user:<userId>` room — it only subscribes sockets to broadcast rooms.

Note: the actual `community:new-message`, `community:message-updated`, and `community:message-deleted` events are **emitted from `communityController.js`** via `io.to(room).emit(...)`, not from this module. This module only handles the socket join handshake.

**Connection lifecycle:**

| Step | What happens |
|---|---|
| Token extracted | Same helper as chatSocket |
| JWT verified | Silently dropped on failure (no error event) |
| `accountStatus` queried | Connection dropped if not `ACTIVE` |
| `role` set on socket | `socket.data.role = normalizeRole(account.userRole)` |

**Client → Server events:**

| Event | Payload | Description |
|---|---|---|
| `joinCommunityRoom` | `roomId: string` | Joins `community-room:<roomId>`. Rejected with `community:error` if the user does not have an existing `RoomMembership` row (i.e., must first join via the REST API). |
| `joinModerationFeed` | _(none)_ | Joins `community-moderation`. Only allowed for `NGO_ADMIN` role. |

**Server → Client events (broadcast from communityController.js):**

| Event | Room | Payload | Description |
|---|---|---|---|
| `community:new-message` | `community-room:<roomId>` | Message object | New community message posted. |
| `community:message-updated` | `community-room:<roomId>` | Updated message | Message edited (currently unused). |
| `community:message-deleted` | `community-room:<roomId>` | `{ messageId }` | Moderator removed a message. |
| `community:report-created` | `community-moderation` | _(varies)_ | New harmful-content report filed. |
| `community:report-reviewed` | `community-moderation` | _(varies)_ | Moderation decision recorded. |
| `community:error` | _(requesting socket)_ | `{ error: string }` | Auth or membership check failed. |

---

## Room Naming Conventions

| Room name | Who joins | Purpose |
|---|---|---|
| `user:<userId>` | All authenticated chat users | Personal room for presence updates, delivery receipts, and notification push |
| `<chatId>` (bare UUID) | Socket after `joinChannel` | Direct chat channel room |
| `community-room:<roomId>` | Socket after `joinCommunityRoom` | Community room broadcast |
| `community-moderation` | NGO_ADMIN sockets | Moderation-feed broadcast |

---

## Presence System

The presence system is implemented in `backend/src/services/presenceRegistry.js` as a **shared in-memory singleton**. It is not database-persisted because presence is ephemeral and DB writes per connect/disconnect would add latency.

### Data structure

```
Map<userId, Set<socketId>>
```

A user is "online" if their Set is non-empty. This correctly handles multiple open tabs — the user stays online as long as any one tab is connected.

### API

| Function | Returns | Description |
|---|---|---|
| `markOnline(userId, socketId)` | `boolean` | Adds socketId to the user's set. Returns `true` if this is the user's first socket (they just came online). |
| `markOffline(userId, socketId)` | `boolean` | Removes socketId from the set. Returns `true` if the set is now empty (user fully offline). |
| `isOnline(userId)` | `boolean` | Returns whether the user has any active connections. |
| `getEffectivePresence(userId, manualStatus)` | `'AVAILABLE'|'BUSY'|'OFFLINE'` | Derives the survivor-visible presence label. |

### Effective presence semantics

```
socket connected + manualStatus = BUSY   → BUSY
socket connected + any other status      → AVAILABLE
no active socket                         → OFFLINE  (always overrides DB setting)
```

The `manualStatus` comes from `CounsellorProfile.availabilityStatus` or `LegalCounselProfile.availabilityStatus`. Socket connectivity is always authoritative — a staff member cannot appear AVAILABLE in chat if their socket is disconnected.

### Presence broadcast flow

When a staff member's first socket connects or their last socket disconnects, `broadcastPresenceForStaff` is called. It:

1. Finds all active `DirectChatChannel` rows where `supportStaffCounterpartId = staffUserId`.
2. Resolves the survivor `userId` for each channel (survivorId → SurvivorProfile → userId).
3. Emits `presence:update` to each survivor's `user:<survivorUserId>` room.

This means the event reaches the survivor regardless of which channel they currently have open.

---

## Delivery Catch-Up

When a user reconnects, `runDeliveryCatchUp` bulk-sets `deliveredAt` on all messages that were sent to them while they were offline:

1. Finds all active channels where this user participates.
2. Queries `DirectChatMessage` where `senderUserId ≠ userId` and `deliveredAt IS NULL`.
3. Bulk-updates `deliveredAt = now`.
4. Groups by `chatId` and emits `message:delivered` to both the channel room and the sender's `user:<senderUserId>` room.

---

## Frontend Socket Client

### notificationSocket.js (`frontend/src/services/notificationSocket.js`)

A singleton socket.io-client for receiving `notification:new` push events. It is separate from the ad-hoc socket instances created inside `ModerationDashboardPage` and `CommunityPage`, which use inline `io()` calls.

```js
// Usage pattern
import notificationSocket from './notificationSocket';

notificationSocket.connect(authToken);
notificationSocket.subscribe((payload) => {
  // payload: { notificationId, category, message, createdAt, entityType, entityId }
  updateBadgeCount();
});

// On sign-out
notificationSocket.unsubscribe(handler);
notificationSocket.disconnect();
```

The singleton pattern (`autoConnect: false` + a module-level `io()` instance) ensures only one connection is opened regardless of how many components subscribe.

The 30-second poll in `NotificationBell` is kept as a reconciliation fallback. The socket provides the zero-latency path; the poll catches anything that was missed during a disconnection window.

---

## Security Considerations

- **JWT required on all sockets.** No unauthenticated connections are accepted.
- **Account status re-checked from DB**, not only from JWT claims. A ban takes effect immediately without waiting for token expiry.
- **Channel membership enforced per-event** (not just at join time) in `chatSocket.js`.
- **Server stores only ciphertext.** `encryptedPayload` is persisted as-is in `DirectChatMessage.encryptedMessageContent`. The server has no AES key and cannot read message content.
- **Personal rooms (`user:<userId>`) are joined server-side** at socket connect, not client-side. A client cannot subscribe to another user's room.

---

## Diagram: Direct Chat Message Flow

```
Client (survivor)                  Server                        Client (staff)
─────────────────                  ──────                        ──────────────
connect(token)         ──►   JWT verify
                              accountStatus check
                              socket.join('user:<survivorId>')
                              presenceRegistry.markOnline()

joinChannel(chatId)    ──►   canUserAccessChannel()
                              socket.join(chatId)

sendEncryptedMessage   ──►   isUserAccountActive()
{ chatId,                     canUserAccessChannel()
  encryptedPayload }           DirectChatMessage.create()
                              presenceRegistry.isOnline(staffId)?
                              io.to(chatId).emit('receiveMessage')
                                                                ◄──  receiveMessage
                              if recipient online:
                              io.to('user:<survivorId>').emit(
                                'message:delivered')
                     ◄──  message:delivered
```
