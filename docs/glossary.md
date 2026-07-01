# Glossary

Platform-specific terms, domain vocabulary, and technical concepts used throughout the GBV Support Platform codebase. Entries are grouped by topic; use your editor's search to jump to a specific term.

---

## Domain Roles

### Survivor
A registered user who has experienced gender-based violence and uses the platform to file incident reports, receive counselling and legal support, access community rooms, and chat securely with assigned staff. Every survivor has a `survivorProfile` row linked to their `userAccount`. In community spaces, survivors are identified only by their `displayNickname` — their real identity is never exposed. See `backend/src/models/survivorProfile.js`.

### Counsellor
A registered staff member assigned to one or more survivors. Provides psychosocial support via direct chat, reviews incident reports, and can upload support resources. Auto-assigned to incoming survivors via `currentWorkloadScore`. See `backend/src/models/counsellorProfile.js`.

### Legal Counsel
A registered staff member with a legal specialization. Reviews incident reports, provides legal guidance via direct chat, and authors legal case documentation. Can escalate reports to legal cases with survivor consent. Auto-assigned alongside the counsellor. See `backend/src/models/legalCounselProfile.js`.

### NGO Admin
The sole admin role on the platform. Has the highest operational authority: analytics dashboard, staff management, survivor case triage, community room creation, moderation desk access, USSD callback queue, and maintenance mode control. The System Admin role was removed — all capabilities now belong to NGO Admin. See `backend/src/models/ngoAdministratorProfile.js`.

### Moderator
A community safety enforcer provisioned by NGO Admin. Has access to the Moderation Desk (harmful content report queue, ban/warn actions) and Community Chat. Cannot access survivor data, reports, or the NGO analytics dashboard. Onboarded via the same staff provisioning flow as counsellors and legal counsel. See `backend/src/models/moderatorProfile.js`.

### Unregistered Visitor
A user who has not created an account. Can browse the public support resource library and access the emergency reporting intercept page (`/reports`). Cannot use authenticated features (direct chat, personal incident reports, community rooms).

---

## Core Domain Concepts

### Incident Report
The primary record submitted by a survivor describing a GBV incident. Progresses through a 7-state lifecycle managed by NGO staff. Can have zero or many evidence files attached, and at most one legal case escalated from it. See `backend/src/models/incidentReport.js` and `docs/reporting.md`.

### Report Status State Machine
The seven states an incident report moves through:
```
SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION
         → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE
         → RESOLVED
         → WITHDRAWN
```
Transitions are role-scoped: survivors can only `WITHDRAW`; NGO staff advance all other states. Legal case auto-creation fires on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE` transitions.

### Evidence File
A file (image, PDF, or audio) uploaded by a survivor alongside an incident report. File bytes are stored in Cloudinary (private/authenticated). Only metadata is stored in the database (`evidenceFile` table). Delivered to authorised viewers via `GET /api/reports/:reportId/evidence/:evidenceId/file` — a backend streaming proxy that never exposes Cloudinary URLs to the browser. See `backend/src/models/evidenceFile.js`.

### Legal Case File
A formal legal case record created when an incident report is escalated with survivor consent. Contains structured authoring fields (`caseSummary`, `legalGrounds`, `requestedRelief`, `recommendedActions`) that legal counsel fill in-app. A PDF can be generated on demand from these fields and stored privately in Cloudinary. Exactly one legal case per incident report (enforced by UNIQUE constraint). See `backend/src/models/legalCaseFile.js`.

### Community Room
A group discussion space created by NGO Admin. All participants post under their nickname (pseudonymous). Community messages are **not** end-to-end encrypted — moderators can read plaintext for safety enforcement. Contrast with Direct Chat, which is E2EE. See `backend/src/models/communityRoom.js`.

### Community Message
A plaintext message posted in a community room. Visible to all room participants and moderators. The sender is shown by `displayNickname` only. Can be flagged as harmful by any user, triggering a moderation review. See `backend/src/models/communityMessage.js`.

### Support Resource
Categorised content (guides, hotlines, referrals) uploaded by counsellors, legal counsel, or NGO Admins. Accessible to all users and unregistered visitors — the library is public. Static fallback data (`frontend/src/data/fallbackResources.js`) is shown when the backend is unreachable. See `backend/src/models/supportResource.js` and `docs/resource-management.md`.

### USSD Callback Request
A callback request submitted via the Africa's Talking USSD interface. No user account is required — only a phone number is captured. At creation time, the least-loaded available counsellor is auto-assigned. NGO Admin can still manually reassign from the USSD Callbacks section of the dashboard. See `backend/src/models/ussdCallbackRequest.js` and `docs/ussd.md`.

### HarmfulContentReport
Created when a registered user flags a community message as harmful or abusive. Queued in the Moderation Desk for a moderator or NGO Admin to review. The reviewer can reject the flag, approve it with a message removal, approve it with a user ban, or approve it with a warning. See `backend/src/models/harmfulContentReport.js`.

---

## Authentication and Security

### OTP (One-Time Password)
A 4-digit numeric code delivered via SMS (Africa's Talking) that expires after a short window. Used in three flows: signup OTP (step 1 of 3-step registration), sign-in 2FA (mandatory second factor after password verification), and password reset. All OTPs are bcrypt-hashed (10 rounds) before storage — plaintext is never persisted. In development mode (`SKIP_SMS_IN_DEV=true`), the plaintext code is returned in the response body under `developmentOtp`. See `backend/src/controllers/authController.js`.

### Signup Ticket
A short-lived credential issued after successful OTP verification in step 2 of signup. The ticket is stored in the same `otpHash` field with `otpPurpose = 'SIGNUP_TICKET'`. The client presents it in step 3 (`complete-signup`) to prove that OTP verification happened before setting the password. Prevents skipping the OTP step.

### authStage
A string field returned in auth API responses to communicate what step the client should move to next. Examples:
- `DETAILS_REQUIRED` — OTP verified; client should show step 3 of signup
- `OTP_2FA_REQUIRED` — password verified; client should show 2FA OTP entry
- `PASSWORD_RESET_REQUIRED` — staff first login; client must call `set-password` before navigating
- `SIGNIN_REQUIRED` — phone already has an account; client should switch to sign-in mode

### 2FA (Two-Factor Authentication)
Mandatory second factor enforced on every sign-in. After a successful password verification, the backend sends a `SIGNIN_2FA` OTP and blocks the JWT until the OTP is verified via `POST /api/auth/verify-2fa`. There is no standalone OTP-only login method — OTP is always the second factor. Exception: staff with `status = password_reset_required` receive the JWT immediately from `login-password` (they must set a real password before normal navigation, so 2FA is deferred to their next login).

### JWT (JSON Web Token)
Session credential issued after successful 2FA verification. Carries `{ id, userId, role, userRole }` in the payload (dual fields for backward compatibility). Stored in `sessionStorage` (tab-scoped; cleared on tab close). `authMiddleware` verifies the signature and does a live DB lookup on every authenticated request to enforce account status changes immediately.

### liftExpiredBan
A function called by `authMiddleware` on every authenticated request. If `banExpiresAt` is set and is in the past, it automatically restores the account to `ACTIVE` and clears all ban metadata fields. This means temporary bans self-heal at the user's next login without any admin action.

### BANNABLE_ROLES
The roles that can be banned via the moderation system: `['SURVIVOR', 'COUNSELLOR', 'LEGAL_COUNSEL']`. `NGO_ADMIN` and `MODERATOR` are excluded — removing those accounts requires a full staff deactivation workflow. Defined in `backend/src/utils/roles.js`. Enforced identically in both the admin ban endpoint and the community `reviewReport` ban action.

### normalizeRole
A utility function (`backend/src/utils/roles.js`) that converts loose role strings from JWT payloads or request bodies into a canonical uppercase form. Handles camelCase variants from older token issuers (`"legalCounsel"` → `"LEGAL_COUNSEL"`, `"ngoAdmin"` → `"NGO_ADMIN"`).

---

## End-to-End Encryption (E2EE)

### ECDH P-256
Elliptic Curve Diffie-Hellman key agreement using the P-256 curve, implemented via the Web Crypto API. Used to derive a per-channel shared AES-GCM key for direct chat encryption. Each user generates an ECDH key pair; only the public key is sent to the server.

### AES-GCM 256-bit
Symmetric encryption algorithm used to encrypt direct chat messages. The key is derived client-side from the ECDH shared secret. Ciphertext is what the server stores and relays — plaintext never leaves the sender's device unencrypted.

### ecdhPublicKey
Column on `userAccount` storing the user's ECDH P-256 public key as a JWK (JSON Web Key) string. Registered/refreshed by `App.jsx` on every authenticated app load. NULL until the user has logged in at least once since the E2EE feature shipped. See `backend/src/controllers/chatController.js` (`getPublicKey`, `setPublicKey`).

### IndexedDB (Private Key Storage)
The user's ECDH private key is generated as `non-extractable` and persisted only in the browser's IndexedDB via `frontend/src/utils/keyStorage.js`. It never leaves the browser and is never sent to the server. If the user clears their browser data or switches browser profiles, the private key is lost — messages in existing channels cannot be decrypted.

### Pending Message Queue
When a counterpart has no public key yet (hasn't logged in since E2EE shipped), outgoing messages are queued client-side in `localStorage` per `chatId` (`frontend/src/utils/pendingMessageQueue.js`). They are auto-sent once the counterpart's key becomes available, signalled by the `chatKey:available` Socket.io event or a 30-second polling fallback.

### chatKey:available
A Socket.io event emitted by the backend when a user registers their ECDH public key. Fanned out to the counterpart users of all channels the key-registering user participates in. Triggers the pending message queue drain in `DirectChatPage.jsx`. See `backend/src/controllers/chatController.js`.

---

## Presence System

### presenceRegistry
An in-memory singleton (`backend/src/services/presenceRegistry.js`) tracking live socket connections as a `Map<userId, Set<socketId>>`. Maintains real-time online/offline state without a database round-trip per status change. `markOnline(userId, socketId)` and `markOffline(userId, socketId)` are called from `chatSocket.js` on connect/disconnect.

### Effective Presence
The presence state surfaced to the survivor's chat UI. Computed by `getEffectivePresence(userId, manualStatus)` in `presenceRegistry.js`. If the staff member is genuinely connected (at least one socket) but has set their status to BUSY, the effective presence is BUSY. If disconnected, it is OFFLINE regardless of stored status.

### BUSY Override
Staff members can manually set their availability to `BUSY` via their profile. This overrides AVAILABLE presence even when they have active sockets. The override is stored as `availabilityStatus` on `counsellorProfile` or `legalCounselProfile`. See `getEffectivePresence` in `presenceRegistry.js`.

### deliveredAt / seenAt
Columns on `directChatMessage` tracking the delivery and read state of E2EE messages. `deliveredAt` is set server-side when the recipient's socket acknowledges the message (either immediately on send if online, or in bulk catch-up on reconnect). `seenAt` is set when the recipient marks the channel as read (`markChannelRead`). Drives Sent / Delivered / Seen tick indicators in the sender's chat view.

---

## Workload Assignment

### currentWorkloadScore
An integer counter on `counsellorProfile`, `legalCounselProfile`, and `moderatorProfile`. For counsellors and legal counsel, it counts active survivors currently assigned — the auto-assignment algorithm always selects the ACTIVE staff member with the **lowest** score. For moderators, it counts total moderation actions taken (a capacity-visibility counter, not a routing input).

### Auto-Assignment (pickLeastLoadedStaff)
On survivor signup, `ensureSurvivorStaffAutoAssignment` in `authController.js` selects the least-loaded ACTIVE counsellor and least-loaded ACTIVE legal counsel (using an inner join with `userAccount` requiring `accountStatus = 'ACTIVE'`) and sets them on the new `survivorProfile`. Suspended or banned staff are never recommended or auto-assigned.

### cascadeReassignOnStaffBan
Function in `adminController.js`. When a COUNSELLOR or LEGAL_COUNSEL is banned, all of their active survivors are automatically reassigned to the next least-loaded ACTIVE staff member of the same type. Triggered from both the admin `PATCH /api/admin/ngo/users/:id/ban` endpoint and the community `reviewReport` ban action, so a counsellor banned for harmful community behaviour also loses their caseload.

### getLeastLoadedStaff
Function in `adminController.js` that selects a replacement staff member (lowest `currentWorkloadScore`, ACTIVE account). Used by `cascadeReassignOnStaffBan` and also by `GET /api/admin/ngo/reassignments/suggestions` to recommend a replacement for the manual Team Capacity reassignment form.

---

## Moderation System

### Dual Audit Trail
When a moderation action is taken (ban, warn, message removal), two records are written: one to `ModerationActionLog` (moderation-specific: moderatorUserId, targetUserId, actionType) and one to `AuditLog` (general platform: actorUserId, actionType, targetEntity). Together these provide comprehensive accountability for security monitoring and compliance.

### ModerationActionLog
Immutable log of every moderation action. Two FK relationships to `userAccount` with `as` aliases: `moderator` (the actor) and `targetUser` (the subject). See `backend/src/models/moderationActionLog.js`.

### AuditLog
General-purpose audit trail. Broader scope than `ModerationActionLog` — covers logins, report submissions, assignment changes, and other significant platform events. See `backend/src/models/auditlog.js`.

---

## Schema and Infrastructure

### UUID PKs (VARCHAR(36))
Most domain entities use `crypto.randomUUID()`-generated UUIDs as primary keys, stored as `VARCHAR(36)`. Prevents enumeration attacks: an attacker cannot guess adjacent resource IDs by incrementing an integer. The `(36)` width accommodates 32 hex digits + 4 hyphens.

### ENUM Drift / schemaCompatibility.js
MySQL ENUMs require `ALTER TABLE` to add members, which can cause data-truncation errors on existing rows that have values outside the new member list. `backend/src/utils/schemaCompatibility.js` runs idempotent DDL guards on every server boot: first a data-backfill UPDATE (prevents truncation errors), then `MODIFY COLUMN` to add new members. Controlled by the `ENABLE_SCHEMA_COMPAT` environment variable (default `true`). Manual `ALTER TABLE` commands for ENUM changes are deprecated.

### MySQL BOOLEAN = TINYINT(1)
Sequelize's `DataTypes.BOOLEAN` maps to `TINYINT(1)` in MySQL. MySQL has no native boolean type. Columns declared as BOOLEAN will show as `0`/`1` in raw SQL output — this is expected, not a schema mistake.

### SystemSetting Table
Key/value store for durable platform-level configuration that must survive process restarts. Currently used for the maintenance mode state (`settingKey = 'maintenance'`). Loaded into an in-memory cache at boot via `loadMaintenanceStateFromDb()` in `backend/index.js`. See `backend/src/models/systemSetting.js`.

### Maintenance Mode
A global platform state toggled by NGO Admin from the dashboard. When enabled, all non-NGO-Admin traffic receives HTTP 503. State is persisted in the `SystemSetting` table and cached in `_maintenanceCache`. Polled by the frontend every 15 seconds from `/api/system/public-status`. Only `NGO_ADMIN` sessions bypass the maintenance screen.

### Cloudinary
Third-party cloud media storage. All uploaded files (evidence, support resources, legal case PDFs) are stored in Cloudinary with `type: authenticated` (private). **Cloudinary URLs and signed URLs never reach the browser** — all file delivery goes through backend streaming proxies that stream the file content and return it as a response. See `backend/src/config/cloudinary.js` (`fetchPrivateAssetStream`).

### Africa's Talking
Third-party service providing SMS OTP delivery and USSD session handling. Required environment variables: `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`. Set `SKIP_SMS_IN_DEV=true` to skip SMS delivery in development — the OTP is returned in the response body instead.

---

## Frontend Architecture

### SPA Router (window.history.pushState)
The frontend uses a custom single-page application router built on `window.history.pushState`. There is no React Router. Navigation is section-based within large page components. Role-based route maps in `frontend/src/App.jsx` determine which page each role sees. See `docs/frontend-architecture.md`.

### sessionStorage (Tab-Scoped Auth)
`authToken` and `userId` are stored in `sessionStorage` (not `localStorage`). This means the session is tab-scoped — cleared when the tab is closed. Opening the app in a new tab requires re-authentication. This is a deliberate security choice for the survivor context. See `frontend/src/utils/auth.js`.

### No Shared State
The frontend uses no Context API, Zustand, or any global state management. All state is component-local with prop drilling. Data is re-fetched per component mount.

### Quick Exit Button
A UI element that clears auth state and navigates the browser to Google. Designed for survivors who need to quickly hide their activity. Auto-collapses after 3 seconds of inactivity.

### fallbackResources
A static array in `frontend/src/data/fallbackResources.js` containing support resources (hotlines, shelters, legal aid contacts) shown in the Library page when the backend is unreachable. Ensures the library is never completely empty for a visitor in a crisis.

### color-scheme: light (Forced Light Theme)
The platform enforces a single light theme. An earlier `@media (prefers-color-scheme: dark)` override was removed. `index.html` pins `<meta name="color-scheme" content="light">` so native form controls and scrollbars don't switch to dark mode regardless of the visitor's OS preference. CSS custom properties in `frontend/src/App.css` define the only theme.

---

## Chat and Channels

### ensureAutoChannelsForSurvivor
A service function in `backend/src/services/chatAccessService.js`. Creates one direct chat channel per assigned staff member using `findOrCreate` (idempotent). Called on channel list fetch and during signup. Means no manual channel creation is ever needed — channels are always available.

### chatChannelStatus
The lifecycle state of a `directChatChannel`. Values: `active` (default), `archived` (hidden but accessible), `deleted` (soft-deleted — data preserved, not shown in main view). Survivors can archive, restore, and delete their own channels. Staff never see deleted channels. Restored via `PATCH /api/chat/:chatId/status`.

---

## Notifications

### notificationDismissedStatus vs. notificationReadStatus
These are two separate columns on `inAppNotification`. `notificationReadStatus` (`UNREAD`/`READ`) tracks whether the user has read the notification. `notificationDismissedStatus` (`VISIBLE`/`DISMISSED`) tracks whether the user has cleared/dismissed it from the panel. A user can dismiss without reading (e.g. mass dismiss) or read without dismissing. Both states are stored to support separate "mark all as read" and "clear all" UI actions.

### Discreet Wording Policy
All notification messages must avoid mentioning GBV, counselling, or the platform's purpose. Example compliant text: "You have a new message." or "Your request has been updated." This protects survivor safety in case a notification is seen on a shared or unlocked device. Enforced at write time in `notificationService.js`, the single write path for all notifications.

### notificationService.js
The single write path for all in-app notifications (`backend/src/services/notificationService.js`). Called by `reportController`, `chatSocket`, and `communityController`. Delivers notifications in real time via Socket.io (`notification:new` on the `user:<userId>` personal room) with a 30-second polling fallback.
