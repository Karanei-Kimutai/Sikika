# Community Moderation

This document covers the architecture, data model, and operational workflows for the Sikika platform's community chat and moderation system. It describes how rooms work, how survivor identity is protected, how harmful content is reported and actioned, and how the moderation role integrates with the broader platform.

---

## Overview

Community is one of Sikika's two primary support channels. It provides a moderated, peer-support space where survivors can ask questions, share coping strategies, and interact with verified staff. The system is structured around named **rooms** (topic-scoped channels), **messages** posted to rooms, and a **harmful-content report queue** that moderators and NGO admins use to review flagged messages.

Key design principles:

- **Privacy by default.** Survivors appear only by their self-chosen display nickname. No real names, phone numbers, or profile data appear in room timelines.
- **Membership gating.** Members must explicitly join a room before reading its history or posting.
- **Pull-queue moderation.** The harmful-content report queue is shared across moderators; no report is pre-assigned to a specific moderator.
- **Real-time delivery.** Room messages, moderation events, and report updates are pushed over Socket.io so all connected clients see changes without polling.

---

## Roles With Community Access

| Role | Capabilities |
|---|---|
| `SURVIVOR` | Join rooms, post messages, report messages, self-delete own posts |
| `COUNSELLOR` | Same as survivor; posts display a "Verified Counsellor" badge |
| `LEGAL_COUNSEL` | Same as survivor; posts display a "Verified Legal Counsel" badge |
| `NGO_ADMIN` | Full access + create rooms + delete any message + review moderation reports |
| `MODERATOR` | Delete any message + review moderation reports (no room creation) |

Unregistered visitors have no community access — the community socket requires a valid JWT.

---

## Room Lifecycle

### Default Room Seeding

On every call to `GET /api/community/rooms`, the backend runs `ensureGeneralRoomExists()`, which idempotently seeds four default rooms if they do not yet exist:

- General Support
- Legal Guidance
- Emotional Support
- Safety Planning

The seed function uses a name-based Set lookup so it can be called on every request without duplicating rooms. The earliest-created room is returned as the seeding function's return value (used in tests), but clients receive the full sorted list from `listRooms`.

### Room Creation (NGO Admin Only)

`POST /api/community/rooms` — NGO admins can create additional topic rooms. The creator is auto-joined to the new room so they can moderate it immediately without a separate join step.

Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `roomName` | string | yes | Displayed in the room list |
| `roomDescriptionText` | string | no | Short topic description |

### Joining a Room

`POST /api/community/rooms/:roomId/join` — idempotent membership creation via `RoomMembership.findOrCreate`. Calling join on an already-joined room returns 200 with no side effects.

Posting a message (`POST /api/community/rooms/:roomId/messages`) also auto-joins the room on first post, so explicit join is optional for post-first UX flows.

### Reading Room History

`GET /api/community/rooms/:roomId/messages` — requires membership. Non-members receive HTTP 403 (`"Join this room first to view messages."`). This guard prevents silent data exposure from unauthenticated or non-member requests.

In non-production environments, the first read of an empty room triggers `seedDemoMessagesForRoom`, which pre-populates 15 starter messages under the requesting user's account. This is suppressed in `NODE_ENV=production`.

---

## Survivor Identity in Community

Survivors are pseudonymized in all community-visible contexts. The `getDisplayIdentity(userId)` helper resolves the display identity for every message sender:

| Sender Role | `displayName` | `badge` |
|---|---|---|
| `SURVIVOR` | Value of `SurvivorProfile.displayNickname` (or "Anonymous Survivor") | `null` |
| `COUNSELLOR` | "Verified Counsellor" | "Verified Counsellor" |
| `LEGAL_COUNSEL` | "Verified Legal Counsel" | "Verified Legal Counsel" |
| `NGO_ADMIN` | "Verified NGO Administrator" | "Verified NGO Administrator" |
| `MODERATOR` | "Verified Moderator" | "Verified Moderator" |

Real names, phone numbers, and role-specific profile data are never included in the display identity object. This applies to both the REST `listMessages` response and the real-time `community:new-message` socket payload.

---

## Posting Messages

`POST /api/community/rooms/:roomId/messages` — body: `{ content: string }`.

Workflow:

1. Actor context is resolved and verified (must be `ACTIVE`).
2. Room is fetched.
3. `RoomMembership.findOrCreate` auto-joins the actor if not already a member.
4. `CommunityMessage` row is created with a UUID `communityMessageId`.
5. `getDisplayIdentity` is called to build the author object.
6. The full message + author payload is emitted via Socket.io to the `community-room:<roomId>` room (`community:new-message`).
7. HTTP 201 is returned with the same payload.

### Deleting Messages

`DELETE /api/community/messages/:messageId`:

- **Message owners** can delete their own posts at any time.
- **NGO admins and Moderators** can delete any message as a moderation action.

When a moderator (not the owner) deletes a message:
- A `ModerationActionLog` row is created with `moderationActionType = "MESSAGE_DELETION"`.
- If the actor is `MODERATOR` (not `NGO_ADMIN`), `incrementModeratorWorkload` bumps `ModeratorProfile.currentWorkloadScore` by 1.
- The socket event `community:message-deleted` is emitted to the `community-room:<roomId>` room.

---

## Harmful-Content Reporting

`POST /api/community/messages/:messageId/report` — body: `{ reason: string }`.

Rules:
- Users cannot report their own messages (returns 400).
- The `reason` field is required.
- Creates a `HarmfulContentReport` row with `moderationReviewStatus = "PENDING"`.
- Emits `community:report-created` to the `community-moderation` Socket.io room so online moderators are notified immediately.

---

## Moderation Queue

### Fetching Reports

`GET /api/community/moderation/reports` — allowed for `NGO_ADMIN` and `MODERATOR`.

Returns all `HarmfulContentReport` rows in reverse-chronological order, hydrated with:
- The full `reportedMessage` object (including the message's author display identity).
- The `reporter` display identity.

The frontend splits the list into "Pending" (status `PENDING`) and "History" (status `APPROVED`/`REJECTED`) tabs client-side, since the backend returns all records in one response.

### Reviewing a Report

`PATCH /api/community/moderation/reports/:reportId` — transactional endpoint.

Required body fields:

| Field | Type | Values |
|---|---|---|
| `reviewStatus` | string | `"APPROVED"` or `"REJECTED"` |
| `action` | string | `"remove_message"`, `"ban_user"`, `"issue_warning"`, `"none"` |
| `reason` | string | (for `ban_user`) Overrides the report's own `reportReasonText` |
| `expiresAt` | ISO date string | (for `ban_user`) Optional ban expiry; must be a future date |

The entire review — report status update, message edit, ban application, and audit logging — is wrapped in a single Sequelize transaction. Post-commit side-effects run outside the transaction to avoid entangling socket and cascade operations.

#### Action: `remove_message`

- Sets `CommunityMessage.publicMessageContent` to `"[Removed by moderators for community safety.]"`.
- Creates `ModerationActionLog` row (`moderationActionType = "MESSAGE_DELETION"`).
- Increments moderator workload if actor is `MODERATOR`.
- Emits `community:message-updated` so clients display the redacted content immediately.

#### Action: `ban_user`

- Validates target user's role against `BANNABLE_ROLES` (`["SURVIVOR", "COUNSELLOR", "LEGAL_COUNSEL"]`). NGO Admin and Moderator accounts cannot be banned through this path.
- Blocks self-ban (actor cannot ban themselves).
- Sets `UserAccount.accountStatus = "BANNED"` with full ban metadata:
  - `banReason` — from `req.body.reason` or the report's `reportReasonText`
  - `bannedAt` — current timestamp
  - `banExpiresAt` — from `req.body.expiresAt` (validated as future date) or `null` for permanent
  - `bannedByUserId` — the reviewing moderator's userId
- Creates a `ModerationActionLog` row (`moderationActionType = "BAN"`).
- Creates an `AuditLog` row (`actionType = "ACCOUNT_BANNED"`).
- Increments moderator workload if actor is `MODERATOR`.

**Post-commit:**
- All live sockets for the banned user are force-disconnected: `io.in("user:<userId>").disconnectSockets(true)`.
- If the banned user is `COUNSELLOR` or `LEGAL_COUNSEL`, `cascadeReassignOnStaffBan` is called via `setImmediate` to reassign their survivors to the next least-loaded active staff member.

#### Action: `issue_warning`

- Creates a `ModerationActionLog` row (`moderationActionType = "WARNING"`).
- Queues an in-app notification to the message author (post-commit) with category `"MODERATION_ALERT"`.
- Increments moderator workload if actor is `MODERATOR`.

#### Legacy Actions Removed

The `"suspend_user"` and `"block_user"` actions were removed. All community moderation enforcement now uses `"ban_user"`, which carries full metadata (reason, expiry, audit trail) and parity with the admin ban endpoint. `SUSPENDED` status is reserved for the operational staff active/inactive toggle in the NGO Admin Team Capacity section.

---

## Moderator Workload Tracking

`ModeratorProfile.currentWorkloadScore` is incremented by `incrementModeratorWorkload(userId, transaction)` after each moderation action taken by a `MODERATOR` actor:

- Direct message deletion (standalone `deleteMessage`)
- `remove_message` action in `reviewReport`
- `ban_user` action in `reviewReport`
- `issue_warning` action in `reviewReport`

`NGO_ADMIN` actors have no `ModeratorProfile` row; `incrementModeratorWorkload` is a no-op for them (early return on `ModeratorProfile.findOne` returning null).

The workload score is **capacity visibility only** — the report queue is not routed per-moderator. Any moderator can pick up any pending report.

---

## Socket Events

Community uses two Socket.io namespaces/rooms:

### `community-room:<roomId>`

Joined by clients on `joinRoom` socket event. Events emitted:

| Event | Trigger | Payload |
|---|---|---|
| `community:new-message` | `postMessage` REST endpoint | `{ roomId, message: { ...messageFields, author } }` |
| `community:message-updated` | `reviewReport` with `remove_message` | `{ messageId, roomId, publicMessageContent }` |
| `community:message-deleted` | `deleteMessage` | `{ roomId, messageId }` |

### `community-moderation`

Joined by clients that emit `joinModerationFeed`. Events emitted:

| Event | Trigger | Payload |
|---|---|---|
| `community:report-created` | `reportMessage` | `{ reportId, roomId }` |
| `community:report-reviewed` | `reviewReport` | `{ reportId, reviewStatus }` |

---

## REST Endpoint Summary

| Method | Path | Role(s) | Description |
|---|---|---|---|
| `GET` | `/api/community/rooms` | Any authenticated | List all rooms with membership and activity metadata |
| `POST` | `/api/community/rooms` | `NGO_ADMIN` | Create a new room |
| `POST` | `/api/community/rooms/:roomId/join` | Any authenticated | Join (idempotent) |
| `GET` | `/api/community/rooms/:roomId/messages` | Members only | List room messages |
| `POST` | `/api/community/rooms/:roomId/messages` | Any authenticated | Post a message |
| `POST` | `/api/community/messages/:messageId/report` | Any authenticated | File a harmful-content report |
| `DELETE` | `/api/community/messages/:messageId` | Owner or NGO_ADMIN/MODERATOR | Delete a message |
| `GET` | `/api/community/moderation/reports` | `NGO_ADMIN`, `MODERATOR` | Fetch all moderation reports |
| `PATCH` | `/api/community/moderation/reports/:reportId` | `NGO_ADMIN`, `MODERATOR` | Review a report |

---

## Data Model

### `CommunityRoom`

| Column | Type | Notes |
|---|---|---|
| `roomId` | `VARCHAR(36)` PK | UUID |
| `roomName` | `STRING` | Unique display name |
| `roomDescriptionText` | `TEXT` | Optional topic description |
| `createdByAdminId` | `VARCHAR(36)` | FK to UserAccount (null for seeded rooms) |
| `roomCreationTimestamp` | `DATE` | Auto-set |

### `RoomMembership`

| Column | Type | Notes |
|---|---|---|
| `membershipId` | `VARCHAR(36)` PK | UUID |
| `roomId` | `VARCHAR(36)` FK | → CommunityRoom |
| `userId` | `VARCHAR(36)` FK | → UserAccount |
| `joinedAt` | `DATE` | Auto-set |

### `CommunityMessage`

| Column | Type | Notes |
|---|---|---|
| `communityMessageId` | `VARCHAR(36)` PK | UUID |
| `roomId` | `VARCHAR(36)` FK | → CommunityRoom |
| `senderUserId` | `VARCHAR(36)` FK | → UserAccount |
| `publicMessageContent` | `TEXT` | Set to redaction string on moderation removal |
| `messageDispatchTimestamp` | `DATE` | Auto-set; used for room activity sorting |

### `HarmfulContentReport`

| Column | Type | Notes |
|---|---|---|
| `contentReportId` | `VARCHAR(36)` PK | UUID |
| `reportedCommunityMessageId` | `VARCHAR(36)` FK | → CommunityMessage |
| `reporterUserId` | `VARCHAR(36)` FK | → UserAccount |
| `reportReasonText` | `TEXT` | Reporter-supplied reason |
| `moderationReviewStatus` | `ENUM` | `PENDING`, `APPROVED`, `REJECTED` |
| `reviewedAction` | `STRING` | The action applied (remove_message, ban_user, issue_warning, none) |
| `reportSubmissionTimestamp` | `DATE` | Auto-set |

### `ModerationActionLog`

| Column | Type | Notes |
|---|---|---|
| `moderationActionId` | `VARCHAR(36)` PK | UUID |
| `moderatorUserId` | `VARCHAR(36)` FK | → UserAccount |
| `targetUserId` | `VARCHAR(36)` FK | → UserAccount |
| `moderationActionType` | `ENUM` | `MESSAGE_DELETION`, `BAN`, `WARNING` |
| `moderationActionReason` | `TEXT` | Reason carried from the report |
| `loggedAt` | `DATE` | Auto-set |

---

## Frontend Integration

### `ModerationDashboardPage.jsx`

Reused by both `MODERATOR` logins (primary view, reached via `moderatorRoutes`) and `NGO_ADMIN` sessions on the `/moderation` route. The backend enforces role permissions independently on every API call; the component does not contain role-specific display branches.

Two tabs:
- **Pending Queue** — cards for each `PENDING` report with three action buttons (Reject, Approve + Remove Message, Approve + Ban User).
- **Review History** — table of `APPROVED`/`REJECTED` reports; clicking a row opens a detail modal.

The component subscribes to the moderation Socket.io feed (`community:report-created`, `community:report-reviewed`) for near-real-time queue refreshes. The `moderationSocket` instance is module-scoped and connects only when a valid auth token is present.

### `CommunityPage.jsx`

Handles room listing, room joining, message history, and message posting. The `canModerate` boolean is derived by reading the role from the JWT client-side (UI-only; server re-validates every request):

```js
const canModerate = role === "NGO_ADMIN" || role === "MODERATOR";
```

Moderation actions visible to `canModerate` users include message deletion and access to the report filing UI.

---

## Security Considerations

- All community endpoints verify `accountStatus === "ACTIVE"` via `getActor()` on every request. A banned or suspended account gets `null` from `getActor` and receives HTTP 401.
- `BANNABLE_ROLES` is imported from `backend/src/utils/roles.js` — the same constant used by the admin ban endpoint. This ensures community bans and admin bans enforce identical role restrictions.
- Self-ban is explicitly rejected in `reviewReport` (`targetAccount.userId === actor.userId` check).
- The moderation Socket.io room (`community-moderation`) is gated at the socket level; only clients in an NGO_ADMIN or MODERATOR session should emit `joinModerationFeed`.
- Message content redaction replaces the text in-place rather than deleting the row. This preserves the report's `reportedCommunityMessageId` FK so the moderation history remains navigable.
