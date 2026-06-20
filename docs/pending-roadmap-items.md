# Pending Roadmap Items Status

This file tracks requested roadmap features that are either incomplete or pending.

Status legend:
- Done: implemented end-to-end in backend and frontend flows.
- Partial: implemented in some layers but missing full user workflow or policy coverage.
- Not Done: not implemented yet as a usable feature.

## 1) USSD Interface and Africa's Talking Integration
Status: Done

What exists now:
- Data model exists for callback requests in backend models.
- Seeder includes sample USSD callback request data.
- Africa's Talking wiring exists for OTP SMS in authentication flow.
- `POST /api/ussd/callback` handles AT session text and returns CON/END responses.
- Two-branch menu: option 1 (request callback → confirm → persist UssdCallbackRequest) and option 2 (emergency contacts listing).
- `GET /api/ussd/callback-requests` and `PATCH /api/ussd/callback-requests/:id` for NGO admin fulfillment.
- NGO admin dashboard "USSD Callbacks" section to view and mark requests completed or cancelled.

## 2) Legal Case Escalation Workflow
Status: Done

What exists now:
- Legal case model and report-to-legal-case linkage exist.
- Escalation guard requires legal counsel role and survivor consent.
- Legal case lifecycle fields and generatedDocumentPath field exist.
- Structured authoring fields added to `legalCaseFile` model: `caseSummary`, `legalGroundsText`,
  `requestedReliefText`, `recommendedActionsText`, `draftLastUpdatedAt`, `documentGeneratedAt`.
- `pdfkit`-based `legalDocumentService.js` renders authored fields into a PDF in memory.
- PDF uploaded privately to Cloudinary (`type: authenticated`, folder `legal-cases/<id>/`) via
  `uploadLegalDocumentBuffer` in `cloudinary.js`; delivered via backend streaming proxy (`GET /api/legal-cases/:legalCaseId/document`).
- New `legalCaseController.js` + `legalCaseRoutes.js` with four endpoints:
    - `PATCH /api/legal-cases/:legalCaseId` — save draft (any subset of four authoring fields)
    - `PATCH /api/legal-cases/:legalCaseId/status` — advance case lifecycle status
      (OPEN→UNDER_INVESTIGATION→READY_FOR_SUBMISSION→SUBMITTED→CLOSED)
    - `POST /api/legal-cases/:legalCaseId/document` — generate PDF + upload to Cloudinary
    - `GET /api/legal-cases/:legalCaseId/document` — stream generated PDF bytes via backend proxy
  All endpoints scoped to the assigned legal counsel via survivor assignment check.
- `fetchReportById` and `toApiLegalCase` in `reportController.js` now return all new fields
  so the drafting panel pre-loads without an extra API call.
- Frontend `legalCases.js` service: `saveLegalCaseDraft`, `updateLegalCaseStatus`,
  `generateLegalCaseDocument`, `getLegalCaseDocumentUrl`.
- `ReportingPage.jsx` drafting panel (LEGAL_COUNSEL role only): four textarea fields,
  Save Draft, Generate Document, Open Document (blob/object URL from proxy stream), and case status advance control.
  Non-legal roles see the existing read-only one-line case summary.
- Tests: `backend/tests/legalCaseController.test.js` — 20 cases covering access control,
  field validation, status-transition rules, Cloudinary-not-configured guard (503), and
  missing-document guard (404).
- Manual handover: system never contacts law enforcement. All handover is performed
  manually by legal counsel after downloading the generated PDF.

## 3) Discreet In-App Notification System
Status: Done

What exists now:
- Persistent notification entity with read/unread and dismissed storage fields.
- Notifications are written in chat/report/moderation flows.
- Discreet wording pattern is enforced in stored notification text (SSD §22.2).
- Read-side API: `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`,
  `PATCH /api/notifications/:id/dismiss`.
- Dismiss state is separate from read state (as required) via `notificationDismissedStatus` column.
- Frontend: `NotificationBell` component in the `SiteHeader` with unread badge, 30s polling,
  dropdown panel with mark-read and dismiss per row, and "Mark all as read" bulk action.
- Tests: `backend/tests/notificationController.test.js` covers list scoping,
  unread count, ownership enforcement, bulk-read, and dismiss.

## 4) Unregistered User Emergency Flow
Status: Done

What exists now:
- Unauthenticated users navigating to /reports see an intercept screen instead of a silent redirect.
- Intercept screen offers two explicit choices: Create Account or View Emergency Contacts.
- Emergency contacts modal shows Police (999/112), Childline Kenya (116), National GBV Hotline (1195).
- Modal closes on Escape, backdrop click, or Close button.
- Returning users have a Sign In link below the primary actions.
- /reports removed from App.jsx protected paths so the intercept renders rather than bouncing to /join.

## 5) Specific Chat and Moderation Actions
Status: Done

5A) Survivor archive/delete direct chats
Status: Done

What exists now:
- Direct chat channel model supports status values including archived/deleted.
- Backend route `PATCH /api/chat/:chatId/status` enforces survivor-only access with valid transitions (active → archived, archived → active, active/archived → deleted).
- `includeArchived` query param on `GET /api/chat/channels` lets survivors fetch archived channels.
- Frontend action menu in `DirectChatPage.jsx` exposes Archive Chat / Restore Chat toggle and Delete Chat button per channel.

5B) Moderation warning action
Status: Done

What exists now:
- Moderation review supports issue_warning action.
- Warning action is persisted in moderation action logs.
- NGO admin dashboard exposes Issue Warning control.

## 6) Staff Presence Indicators
Status: Done

What exists now:
- `availabilityStatus` (AVAILABLE/BUSY/OFFLINE) in counsellor/legal counsel profiles drives
  NGO admin dashboards, profile workflows, and is now combined with real socket connectivity.
- `presenceRegistry.js` — in-memory singleton tracking live socket connections per userId
  (`Map<userId, Set<socketId>>`). Exposes `markOnline`, `markOffline`, `isOnline`,
  `getEffectivePresence(userId, manualStatus)`:
    - not connected → OFFLINE (overrides any DB setting)
    - connected + manual BUSY → BUSY
    - connected → AVAILABLE
- `chatSocket.js` updated:
    - On connect: joins per-user room `user:<userId>`, calls `presenceRegistry.markOnline`,
      broadcasts `presence:update` to affected survivors' per-user rooms, runs delivery catch-up.
    - Delivery catch-up: bulk-marks as `deliveredAt = now` all messages in the user's channels
      sent while they were offline, emits `message:delivered` to channel rooms + sender rooms.
    - On `sendEncryptedMessage`: sets `deliveredAt` immediately if recipient is currently online.
    - On disconnect: calls `presenceRegistry.markOffline`, re-broadcasts OFFLINE if last socket.
- `directChatMessage` model: added `deliveredAt` (DATE) and `seenAt` (DATE) fields.
- `chatController.js` updated:
    - `getChannels`: effective presence computed via `presenceRegistry.getEffectivePresence`
      instead of raw DB enum; `asyncDeliveryHint` updated to improved offline copy.
    - `markChannelRead`: sets `seenAt = now` on newly-read messages; emits `message:seen`
      via `app.locals.io` to channel room and sender's personal room for live tick updates.
- `DirectChatPage.jsx` updated:
    - New socket listeners: `presence:update` (live dot updates), `message:delivered`,
      `message:seen` (patch message state in place for live tick flips).
    - Presence dot (green/amber/grey) + label in sidebar and main header.
    - `MessageTicks` component: ✓ Sent → ✓✓ Delivered (grey) → ✓✓ Seen (blue).
    - History load carries `deliveredAt`/`seenAt` from the API so ticks render on page open.
- `App.css`: presence dot styles, message tick styles, legal draft panel styles.
- Bug fixed: `chatAccessService.js` legal channel type corrected from `"legal_channel"` to
  `"legal_counsel_channel"` to match the model and frontend convention.
- Tests: `backend/tests/chatPresence.test.js` — 8 registry unit tests + 5 markChannelRead
  integration tests covering seenAt, message:seen emission, and no-unread-messages guard.

## 7) Specific NGO Analytics
Status: Done

7A) Average response time
Status: Done

What exists now:
- Backend computes `avgResponseMinutes` and `sampleSize` in `adminController.js`.
- NGO admin dashboard renders `averageResponseMinutes` and sample count in `NgoAdminDashboardPage.jsx`.

7B) Workload visualizations by counsellor/legal counsel
Status: Done

What exists now:
- NGO dashboard provides staffing workload datasets.
- Frontend visualizes assigned survivor workload for counsellors and legal counsel.

## 8) User Banning Workflow
Status: Done

What exists now:
- `BANNED` lifecycle state added to `accountStatus` ENUM on `userAccount`.
- Ban metadata fields: `banReason` (required), `bannedAt`, `banExpiresAt` (optional expiry
  for temporary bans; null = permanent), `bannedByUserId`.
- `PATCH /api/admin/ngo/users/:userId/ban` — NGO admin endpoint. Targets SURVIVOR,
  COUNSELLOR, LEGAL_COUNSEL only; admins not bannable; self-ban rejected; past-date expiry rejected.
- `PATCH /api/admin/ngo/users/:userId/unban` — lifts ban and restores ACTIVE; clears all ban fields.
- Dual audit trail on ban/unban: `ModerationActionLog` (type BAN/UNBAN) + `AuditLog`
  (type ACCOUNT_BANNED/ACCOUNT_UNBANNED).
- Immediate mid-session enforcement: `authMiddleware` now makes a DB lookup on every
  authenticated request and blocks BANNED (and SUSPENDED/DEACTIVATED) accounts immediately
  — no need to wait for JWT expiry.
- Auto-lift of expired temporary bans: `liftExpiredBan()` shared helper called in both
  authMiddleware and login flows; restores ACTIVE when `banExpiresAt` is past.
- `chatSocket.js` accountStatus check on connect and per-send so banned users cannot
  continue direct-chat messaging over a live socket.
- NGO admin dashboard: Ban User button in the moderation desk (opens reason + expiry modal);
  Ban Account / Lift Ban controls in Staff Directory; `accountStatus` badge + ban details shown.
  Banning from the moderation desk resolves the underlying report atomically (report marked APPROVED).
- Lift Ban is available in both Staff Directory (for staff) and Moderation Desk (for community
  members/survivors banned from there) — all banned user types have a reverse path.
- Frontend service: `banUser()` and `unbanUser()` in `frontend/src/services/admin.js`.
- Tests: `backend/tests/banEnforcement.test.js` covers liftExpiredBan, authMiddleware enforcement,
  banUser guards (reason required, past expiry, admin target, self-ban), and unbanUser.
- ~~Known limitation: banning a COUNSELLOR or LEGAL_COUNSEL does NOT auto-reassign their existing survivor caseload~~. **Resolved:** `cascadeReassignOnStaffBan` is implemented and called (via `setImmediate`) whenever a COUNSELLOR or LEGAL_COUNSEL is banned, automatically reassigning their survivors to the next least-loaded staff member. Covered by `backend/tests/banCascade.test.js`.

## 9) Suspend / Ban Overlap Resolution
Status: Done

What changed:
- `SUSPENDED` = reversible operational staff pause (Active / Inactive in the UI). Not punitive.
  Staff Directory (NGO dashboard → Team Capacity) now shows "Set Inactive" / "Set Active" buttons
  wired to `PATCH /api/admin/ngo/staff/:userId/status`. SUSPENDED is displayed as "Inactive"
  in this context. The backend guard prevents using this flip on a BANNED account.
- `BANNED` = moderation/safety enforcement with reason + optional expiry + dual audit trail.
  These are now clearly separate concepts with separate UI surfaces.
- Community moderation "suspend_user" / "block_user" actions removed. The Moderation Desk
  "Suspend User" one-click button is gone. Moderation enforcement now uses "Ban User" (reason +
  optional expiry) which sets BANNED + metadata + dual audit — and also resolves the report
  atomically. The old bare-SUSPENDED path (no metadata, no reverse) is eliminated.
- `communityController.js reviewReport` now handles `action: "ban_user"` and writes the same
  ModerationActionLog(BAN) + AuditLog(ACCOUNT_BANNED) dual trail as the admin ban endpoint.

## Suggested next implementation order
1. ~~Item 4 emergency intercept~~ Done
2. ~~Item 1 USSD live flow~~ Done
3. ~~Item 7A response-time analytics~~ Done
4. ~~Item 3 notification center API + UI~~ Done
5. ~~Item 5A chat archive/delete controls~~ Done
6. ~~Item 6 explicit presence indicator UX~~ Done
7. ~~Item 8 user banning workflow + overlap resolution~~ Done
8. ~~Item 2 dedicated legal document drafting/export workflow~~ Done

## Follow-up items (completed)

All six follow-up items and three quality/security fixes have been implemented.

### Staff-ban assignment cascade
Status: Done

`cascadeReassignOnStaffBan()` in `adminController.js` is called (via `setImmediate`) whenever a
COUNSELLOR or LEGAL_COUNSEL is banned — through either the admin ban endpoint or the community
moderation `ban_user` path (the latter imports `cascadeReassignOnStaffBan` from `adminController.js`
and fires it post-commit alongside the socket eviction). It resolves the banned staff member's
profile, finds all survivors currently assigned to them, picks the least-loaded **active**
replacement (excluding the banned member — `getLeastLoadedStaff` inner-joins `UserAccount` and
requires `accountStatus = 'ACTIVE'`, so a different staff member who happens to also be
suspended/banned is never picked), and calls `applySurvivorReassignment` for each affected
survivor. That helper writes `StaffAssignmentHistory`, resyncs direct-chat channels, and
refreshes workload scores. If no active replacement exists, the survivors are left in place and
the event is logged. Covered by `backend/tests/banCascade.test.js`, including a regression test
asserting the community moderation path triggers the cascade.

### Notification real-time push
Status: Done

`notificationService.js` centralises notification writes across all three call paths (report
status changes, direct-chat messages, community moderation warnings). On every write it emits
`notification:new` to the recipient's `user:<userId>` Socket.io room for zero-latency badge
updates. The 30-second polling in `NotificationBell` is kept as a fallback/reconciliation
mechanism. `notificationSocket.js` is a singleton Socket.io client used by `NotificationBell`
to subscribe to push events; the bell prepends the new notification to the open panel list
without waiting for the next poll cycle.

### Dedicated banned-user registry + unban console
Status: Done

`GET /api/admin/ngo/banned-users` returns all `accountStatus='BANNED'` accounts with
`banReason`, `bannedAt`, `banExpiresAt`, `bannedByUserId`, ordered by `bannedAt DESC`.
Optional `?role=` filter scopes to SURVIVOR, COUNSELLOR, or LEGAL_COUNSEL.
NGO Admin dashboard "Banned Users" section renders a filterable table with one-click
Lift Ban wired to the existing `unbanUser` endpoint. Permanently-banned survivors (previously
only discoverable if they appeared in the Moderation Desk queue) are now always reachable.

### Community moderation role guard parity
Status: Done

`reviewReport(action="ban_user")` in `communityController.js` now enforces the same
bannable-role allow-list (`BANNABLE_ROLES` from `utils/roles.js`) and self-ban rejection as
the admin ban endpoint. NGO_ADMIN accounts cannot be banned through the community
moderation path. The shared `BANNABLE_ROLES` constant ensures both paths stay in sync.

### Immediate forced socket revocation on ban
Status: Done

Both ban paths (admin endpoint `banUser` and community `reviewReport ban_user`) call
`req.app.locals.io?.in('user:<userId>').disconnectSockets(true)` after committing the ban.
This immediately evicts all of the banned user's live sockets — they cannot continue chat or
community sessions without waiting for the next request/message cycle. The existing
`isUserAccountActive` checks in chatSocket remain as defence-in-depth.

### Durable maintenance state (DB-persisted)
Status: Done

`SystemSetting` model (key/value, TEXT JSON, timestamps) stores maintenance state under key
`'maintenance'`. `setMaintenanceMode` writes through to DB on every toggle. `loadMaintenanceStateFromDb()`
is called once at boot after `sequelize.sync()` and restores the cached state so maintenance
mode that was active before a restart is immediately enforced on the next startup.
An in-process cache (`_maintenanceCache`) keeps the maintenance guard fast (no DB round-trip
per request). Presence registry remains in-memory (documented).

---

## Quality / security fixes (completed)

### OTP hashing
Status: Done

OTPs are now bcrypt-hashed before storage in `otpHash` (10 rounds). Both verification paths
(sign-in OTP and password-reset OTP) compare the submitted plaintext against the stored hash
using `bcrypt.compare`. The dev `developmentOtp` field in the response still carries the
plaintext code for local testing; only the hashed version is stored in the DB.
`CLAUDE.md` known-gap note updated.

### normalizeRole deduplication
Status: Done

`backend/src/utils/roles.js` exports `normalizeRole` and `BANNABLE_ROLES`. All seven previous
duplicates across controllers and services (adminController, communityController, reportController,
resourceController, profileController, legalCaseController, reassignmentRequestController,
chatAccessService, communitySocket) now import from this single source.

### Shared notification helper
Status: Done

`backend/src/services/notificationService.js` is the single write path for all in-app
notifications. Replaced the three inline `InAppNotification.create` duplicates in
reportController, chatSocket, and communityController.

## 10) Progress-Presentation Feedback Batch
Status: Done

Addressed eight items of panel feedback from a progress presentation:

- **ID column length / boolean flag**: confirmed (no code change) that all UUID PKs/FKs
  already use `VARCHAR(36)` and `isOtpVerified` is already `DataTypes.BOOLEAN` — MySQL
  always stores `BOOLEAN` as `TINYINT(1)` regardless of declaration.
- **Moderator role**: new `MODERATOR` userRole + `moderatorProfile` table, delegated
  Moderation Desk + Community Chat oversight (`communityController.js`), narrow frontend
  nav via `moderatorRoutes` in `App.jsx`.
- **Signup reworked to OTP-first**: `request-otp` → `verify-otp` (issues a signup ticket,
  no password yet) → `complete-signup` (password + profile details, issues JWT).
- **Signin reworked to password + mandatory 2FA**: `login-password` no longer issues a JWT
  directly — it sends a `SIGNIN_2FA` OTP; `verify-2fa` issues the JWT. The old standalone
  OTP-only signin method was removed.
- **System Admin removed**: NGO_ADMIN is now the only admin role. `SystemAdministratorProfile`
  model, `SystemAdminDashboardPage.jsx`, and the infra/logs/runtime-action endpoints were
  deleted. Maintenance mode (the one capability still needed) was folded into the NGO Admin
  dashboard, re-gated to `NGO_ADMIN`.
- **Dark/light mode consistency**: replaced ~150 hardcoded hex colors in `App.css` with
  existing/new CSS variable tokens (`--surface`, `--community-*`, `--legal-*`, new
  `--status-*` and `--chart-*` tokens) so the existing `prefers-color-scheme: dark` override
  actually reaches every component. No manual toggle added (kept OS-driven, per decision).
- **Auto-suggested staff reassignment**: `getLeastLoadedStaff` helper (shared with the ban
  cascade) backs `GET /api/admin/ngo/reassignments/suggestions`; Team Capacity's manual
  reassignment form shows a "Recommended" badge the admin can apply or ignore. The helper
  (and signup's `pickLeastLoadedStaff`) requires `UserAccount.accountStatus = 'ACTIVE'`, since
  suspending/banning a staff member only flips that field and leaves the profile's
  `availabilityStatus` untouched.
- **USSD callback auto-routing**: `ussdCallbackRequest.assignedCounsellorId` is set at
  creation time via `pickLeastLoadedCounsellor`; the NGO dashboard's USSD Callbacks table
  shows "Assigned To" instead of requiring manual triage.

## 11) Real ECDH E2EE Upgrade
Status: Done

Direct chat previously derived its AES-GCM key via PBKDF2 from the `chatId` itself — a value
the server already knows, so the server could always have re-derived the key. Upgraded to
genuine ECDH (P-256) key agreement so the server only ever brokers public keys and ciphertext.
Full design and threat model documented in `docs/e2ee.md`.

- `userAccount.ecdhPublicKey` (`TEXT('long')`, nullable) added to the Sequelize model — the
  underlying DB column was already provisioned via `schemaCompatibility.js` from an earlier
  pass but had never been wired into the model, a route, or the frontend.
- `GET /api/chat/public-key/:userId` / `PUT /api/chat/public-key` (`chatController.js`,
  `chatRoutes.js`) — authenticated lookup/registration of a user's public key.
- `getChannels` now returns a uniform `counterpartUserId` field on every channel (resolving
  the staff side's `survivorId` → `SurvivorProfile.userId` where needed), so the frontend
  always knows whose public key to fetch regardless of which side is viewing.
- Frontend: `keyStorage.js` (IndexedDB-persisted, non-extractable ECDH keypair per userId),
  `cryptoUtils.js` (`exportPublicKeyJwk`, `deriveSharedKey` — `encryptMessage`/`decryptMessage`
  unchanged, already key-agnostic), `services/chatKeys.js` (public-key fetch/register).
  `App.jsx` registers the local keypair's public half on every authenticated app load
  (covers both fresh logins and refreshes); `DirectChatPage.jsx` derives the shared key
  per channel from the counterpart's public key instead of a passphrase.
- Known limitation (by design, documented in `docs/e2ee.md`): no safety-number verification
  (a malicious server could still MITM the initial key exchange) and no multi-device support
  (private key lives in one browser's IndexedDB).
- Migration note: switching schemes makes previously-stored ciphertext unreadable —
  `decryptMessage` already degrades gracefully; reseed (`node src/seeders/index.js`) for a
  clean dev DB.
- Tests: `backend/tests/chatPublicKey.test.js` — auth requirements, validation, and
  persistence for both public-key endpoints.
