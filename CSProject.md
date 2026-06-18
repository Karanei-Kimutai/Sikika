# Sikika — Project Analysis

**Project:** Sikika, a Gender-Based Violence (GBV) Support Platform for Kenya
**Stack:** React 19 (frontend) · Node.js + Express 5 + Socket.io (backend) · MySQL + Sequelize · Africa's Talking (USSD + SMS OTP) · Cloudinary (file storage)
**Methodology:** Agile Scrum + OOAD
**Last updated:** 2026-06-16

---

## 1. Everything That Must Be Done to Achieve the Goal

The goal is a **dual-channel (Web + USSD), survivor-centred GBV support platform** for Kenyan survivors, with six user roles, real-time communication, evidence management, legal escalation, and NGO oversight.

### 1.1 Core Functional Requirements

| Module | What Needs to Exist |
|--------|---------------------|
| Authentication | OTP-based phone verification, password auth, forgot/reset password, JWT sessions, lockout protection, role-based access |
| Incident Reporting | Report submission, evidence upload, status state machine (7 states), staff status transitions, legal escalation with survivor consent |
| Direct Chat (E2EE) | Auto-provisioned channels per assignment, encrypted message relay, delivery/seen receipts, archive/restore/delete, real-time via Socket.io |
| Community Rooms | Moderated peer rooms, pseudonymous identities, message reporting, moderation review (warn/ban/remove), real-time via Socket.io |
| Resource Library | Public browsable library, staff upload/edit/delete, Cloudinary storage, category + search filter |
| USSD Interface | Africa's Talking callback, menu flow for callback request vs. hotline listing, session state, admin fulfillment queue |
| NGO Admin Dashboard | Staffing workload, survivor assignments, reassignment, staff onboarding, resource management, analytics, moderation queue, banned-user registry |
| System Admin Dashboard | Maintenance mode (durable), audit logs, server runtime actions, infra health, staff directory |
| Notifications | In-app notification center, real-time push + polling, read/dismiss, discreet copy, fan-out on report/chat/moderation events |
| Profile Management | Per-role profile view and edit (survivor nickname/county/gender, staff specialization/availability) |
| Staff Reassignment | Survivor-driven requests, NGO review/approval, auto-pick replacement, workload refresh |
| Legal Case Workflow | Legal case file creation, structured authoring fields, PDF generation via pdfkit, Cloudinary upload, case status tracking |
| RBAC | Six roles: Survivor, Counsellor, Legal Counsel, NGO Admin, System Admin, unregistered visitor |
| Safety UX | Quick Exit button, maintenance screen, emergency contacts for unauthenticated users, emergency intercept screen |
| Banning | BANNED lifecycle state separate from SUSPENDED, ban metadata (reason + optional expiry), NGO admin workflow, cascade reassignment on staff ban, instant socket revocation |
| Analytics | Report trends, by category/status/county/severity, average response time, resource access tracking, workload per staff member |
| Testing | Unit + integration tests per controller, E2E tests for critical user journeys |
| Deployment | Environment hardening, production config validation, process manager setup |

---

## 2. What Has Been Done So Far and How

### 2.1 Backend — Fully Implemented

#### Authentication (`authController.js`, `authRoutes.js`)
- **OTP Signup + Signin:** `POST /api/auth/request-otp` with `authIntent` (SIGNUP_OTP / SIGNIN_OTP) and `POST /api/auth/verify-otp` handle the full OTP lifecycle.
- **Password Auth:** `POST /api/auth/login-password` with bcrypt comparison and per-account failure counters.
- **Forgot/Reset Password:** `POST /api/auth/forgot-password/request` and `/reset` with OTP verification.
- **In-session Password Set:** `POST /api/auth/set-password` for staff who must reset temporary passwords.
- **Lockout:** 5 failed OTP attempts or 5 failed passwords triggers a 15-minute account lock (env-configurable).
- **Phone Normalisation:** Handles `07XXXXXXXX`, `2547XXXXXXXX`, `+2547XXXXXXXX` formats.
- **OTP Security:** OTPs are bcrypt-hashed (10 rounds) before storage in `otpHash`; both verification paths use `bcrypt.compare`. The `developmentOtp` field returns plaintext for local dev only — nothing plaintext reaches the DB.
- **Africa's Talking SMS:** Real OTP SMS delivery in non-dev mode; `SKIP_SMS_IN_DEV=true` bypasses it and returns OTP in the response body.
- **Auto-assignment on Signup:** On OTP verification (first time), a `SurvivorProfile` is created, the least-loaded counsellor and legal counsel are auto-assigned (by `currentWorkloadScore` + `availabilityStatus`), and direct-chat channels are provisioned — all in a single Sequelize transaction.
- **JWT:** 2-hour tokens signed with `JWT_SECRET`, containing both `userId` and `id` for compatibility.
- **Mid-session enforcement:** `authMiddleware` makes a DB lookup on every authenticated request, blocking BANNED/SUSPENDED/DEACTIVATED accounts immediately without waiting for token expiry.

#### Incident Reporting (`reportController.js`, `reportRoutes.js`)
- Full CRUD for survivors on their own reports.
- Evidence upload to Cloudinary via `multer` with UUID filenames; all evidence delivered via backend streaming proxy (`GET /api/reports/:reportId/evidence/:evidenceId/file`) — signed URLs never reach the browser.
- Status state machine with 7 states: SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE / RESOLVED / WITHDRAWN.
- Role-scoped transition permissions: counsellors, legal counsel, and NGO admins each have separate allowed transition sets.
- Legal case auto-creation on LEGAL_REVIEW or ESCALATED_TO_LEGAL_CASE transitions; survivor consent (`survivorConsent: true`) required for escalation.
- Analytics endpoint (NGO admin only): totals, by status/category/severity/county, 30-day trend, legal cases by status.
- Fan-out in-app notifications to all report stakeholders via `notificationService.js`.

#### Direct Chat (`chatController.js`, `chatSocket.js`, `chatAccessService.js`)
- `GET /api/chat/channels` — returns channels with unread counts, counterpart role, effective presence (live socket state via `presenceRegistry`), and `asyncDeliveryHint` for offline staff.
- `GET /api/chat/channels/:chatId/messages` — ordered history; marks messages read on fetch.
- `PATCH /api/chat/channels/:chatId/status` — survivors archive (`active→archived`), restore (`archived→active`), or delete (`active/archived→deleted`) their own channels. Terminal: deleted channels cannot be changed.
- `POST /api/chat/channels/:chatId/read` — explicit read-clearing; sets `seenAt` on newly-read messages and emits `message:seen` to channel room + sender's personal room.
- `chatSocket.js`: JWT-authenticated WebSocket; `joinChannel` (membership-gated) and `sendEncryptedMessage` persist opaque AES-GCM encrypted payloads. On `sendEncryptedMessage`, sets `deliveredAt` immediately if recipient is online. Delivery catch-up on reconnect bulk-sets `deliveredAt` for messages sent while offline.
- **Presence:** On connect, joins `user:<userId>` personal room, calls `presenceRegistry.markOnline`, broadcasts `presence:update` to affected survivors. On disconnect, `presenceRegistry.markOffline` + re-broadcast OFFLINE if last socket.
- **Ban enforcement:** `chatSocket` checks `accountStatus` on connect and per-send so banned users cannot continue over a live socket.
- Channel auto-provisioning (`ensureAutoChannelsForSurvivor`) idempotently creates one channel per assigned staff member whenever channels are fetched.

#### Presence (`presenceRegistry.js`)
- In-memory singleton (`Map<userId, Set<socketId>>`).
- `getEffectivePresence(userId, manualStatus)`: not connected → OFFLINE; connected + BUSY → BUSY; connected → AVAILABLE.
- Unifies real socket connectivity with the manual BUSY override from the profile DB field.

#### Community (`communityController.js`, `communitySocket.js`, `communityRoutes.js`)
- 4 default rooms seeded idempotently: General Support, Legal Guidance, Emotional Support, Safety Planning.
- Join/leave membership; auto-join on first post. Message history (membership-gated).
- Privacy-safe display identities: survivors use nickname, staff get role badges.
- Moderation review (NGO admin): approve/reject + optional `remove_message`, `ban_user` (BANNED + reason + optional expiry + dual audit trail ModerationActionLog + AuditLog, resolves report atomically), `issue_warning` — all transactional.
- `ban_user` in `reviewReport` enforces the same `BANNABLE_ROLES` allow-list and self-ban rejection as the admin ban endpoint. `SUSPENDED`/`block_user` moderation paths removed.
- Immediate socket revocation on ban: `io.in('user:<userId>').disconnectSockets(true)` called after committing any ban.

#### Notifications (`notificationController.js`, `notificationRoutes.js`, `notificationService.js`)
- `notificationService.js` is the single write path for all in-app notifications (report status changes, direct chat messages, community moderation warnings). Emits `notification:new` to the recipient's `user:<userId>` Socket.io room on every write.
- API: `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `PATCH /api/notifications/:id/dismiss`.
- Dismiss state is separate from read state via `notificationDismissedStatus` column (SSD §22.2 discreet wording enforced).
- Frontend: `NotificationBell` in `SiteHeader` with unread badge, 30s polling fallback, dropdown with per-row mark-read and dismiss, and "Mark all as read" bulk action. Socket push via `notificationSocket.js` prepends new items to the open panel without waiting for next poll.

#### USSD (`ussdController.js`, `ussdRoutes.js`)
- `POST /api/ussd/callback` — live Africa's Talking endpoint (no auth middleware, AT calls it directly).
- Two-branch menu state machine driven by `text.split('*')` depth: Option 1 → Request Callback (confirm → create `UssdCallbackRequest`); Option 2 → Emergency Hotlines (END response with Police 999/112, Childline 116, GBV Hotline 1195).
- `GET /api/ussd/callback-requests` and `PATCH /api/ussd/callback-requests/:id` for NGO admin fulfillment queue.
- NGO admin dashboard "USSD Callbacks" section to view and mark requests completed or cancelled.

#### Legal Case Workflow (`legalCaseController.js`, `legalCaseRoutes.js`, `legalDocumentService.js`)
- Endpoints:
  - `PATCH /api/legal-cases/:legalCaseId` — save draft (any subset of four authoring fields: `caseSummary`, `legalGroundsText`, `requestedReliefText`, `recommendedActionsText`).
  - `PATCH /api/legal-cases/:legalCaseId/status` — advance case status (OPEN → UNDER_INVESTIGATION → READY_FOR_SUBMISSION → SUBMITTED → CLOSED).
  - `POST /api/legal-cases/:legalCaseId/document` — generate PDF via pdfkit (in memory), upload privately to Cloudinary (`type: authenticated`).
  - `GET /api/legal-cases/:legalCaseId/document` — stream generated PDF bytes via backend proxy; Cloudinary URL never reaches the browser.
- All endpoints scoped to the assigned legal counsel via survivor assignment check.
- `ReportingPage.jsx` drafting panel (LEGAL_COUNSEL role only): four textarea fields, Save Draft, Generate Document, Open Document (blob/object URL from proxy stream), and case status advance control.

#### User Banning (`adminController.js`, `adminRoutes.js`)
- `BANNED` account status with ban metadata columns: `banReason` (required), `bannedAt`, `banExpiresAt` (null = permanent), `bannedByUserId`.
- `PATCH /api/admin/ngo/users/:userId/ban` — NGO admin only; targets SURVIVOR/COUNSELLOR/LEGAL_COUNSEL; admins not bannable; self-ban rejected; past-date expiry rejected.
- `PATCH /api/admin/ngo/users/:userId/unban` — restores ACTIVE, clears all ban fields.
- Dual audit trail: `ModerationActionLog` (BAN/UNBAN) + `AuditLog` (ACCOUNT_BANNED/ACCOUNT_UNBANNED).
- `liftExpiredBan()` helper called in `authMiddleware` and login flows — auto-restores ACTIVE when `banExpiresAt` is past.
- `cascadeReassignOnStaffBan` called (via `setImmediate`) whenever a COUNSELLOR/LEGAL_COUNSEL is banned, auto-reassigning their survivors to the next least-loaded replacement.
- `GET /api/admin/ngo/banned-users` — filterable registry of all BANNED accounts with ban metadata.

#### NGO Admin (`adminController.js`, `adminRoutes.js`)
- Dashboard: 26+ parallel Sequelize queries returning overview metrics, 30-day report trend, breakdown by category/status/county, community metrics, staff workload, staff directory, survivor assignments, moderation queue, resource analytics, and `avgResponseMinutes`/`sampleSize`.
- Staff onboarding: `createStaffAccount` (counsellor/legal counsel) with temp password, `password_reset_required` status, and audit log — transactional.
- Staff account status: SUSPENDED (reversible operational "Inactive" toggle) separate from BANNED (moderation enforcement). `PATCH /api/admin/ngo/staff/:userId/status` handles SUSPENDED↔ACTIVE; `banUser`/`unbanUser` handle the BANNED lifecycle.
- Global search, survivor reassignment override, USSD callback queue.

#### Maintenance Mode (`adminController.js`)
System Admin was removed — NGO Admin is the only admin role, and maintenance mode (the
one System Admin capability still needed) is folded into the NGO Admin dashboard.
- **Durable maintenance mode:** `SystemSetting` model (key/value, TEXT JSON) stores maintenance state under key `'maintenance'`. `loadMaintenanceStateFromDb()` restores cached state at boot so maintenance survives process restarts. `_maintenanceCache` keeps the guard fast (no DB round-trip per request).
- `POST /api/admin/system/maintenance-mode` is now NGO_ADMIN-gated. The infra/health/log-streaming and runtime-action (`CLEAR_CACHE`/`RESTART_SERVER`) endpoints that used to live alongside it were removed along with the System Admin role.

#### Moderator (`communityController.js`)
Delegated subset of NGO Admin responsibilities: Moderation Desk (reports queue, message
removal, warnings, bans) + Community Chat oversight. Own `MODERATOR` userRole ENUM member
and `moderatorProfile` table (`currentWorkloadScore`, incremented per moderation action for
capacity visibility — the report queue itself stays a shared pull queue).

#### Resource Library (`resourceController.js`, `resourceRoutes.js`)
- Public read (no auth required): list with category filter and text search.
- Staff upload: Cloudinary (`type: authenticated`); delivered via backend streaming proxy (`GET /api/resources/:resourceId/file`, unauthenticated — library is public).
- Update: metadata-only or file replacement; old Cloudinary asset deleted after new save.
- Delete: DB row then Cloudinary cleanup.

#### Shared Utilities
- `backend/src/utils/roles.js` — single source for `normalizeRole` and `BANNABLE_ROLES`. All controllers import from here; the previous 7 duplicates have been removed.
- `backend/src/utils/schemaCompatibility.js` — `ensureSchemaCompatibility(sequelize)` runs idempotent DDL guards on every boot (data-backfill UPDATE first, then MODIFY COLUMN for ENUM additions). Gated by `ENABLE_SCHEMA_COMPAT` env flag. Manual `ALTER TABLE` is deprecated in favour of adding reconciliation steps here.
- `backend/src/config/cloudinary.js` — `fetchPrivateAssetStream({ publicId, resourceType })` shared helper handles `private_download_url` fetch and redirect follow for all three proxy delivery paths (resources, evidence, legal PDFs).

#### Profile (`profileController.js`, `profileRoutes.js`)
- `GET /api/profile/me` — user account + role-specific profile + assigned staff details (for survivors includes counsellor/legal counsel user IDs and phone numbers).
- `PATCH /api/profile/me` — role-aware partial update.

#### Staff Reassignment Requests (`reassignmentRequestController.js`, `reassignmentRequestRoutes.js`)
- Survivor creates request (scope: COUNSELLOR / LEGAL_COUNSEL / BOTH), one pending at a time enforced.
- NGO admin lists, approves (picks least-loaded replacement, calls `applySurvivorReassignment`, writes history, resyncs channels, refreshes workload), or rejects.

#### Data Models (Sequelize, all in `backend/src/models/`)
25 entities: `UserAccount`, `SurvivorProfile`, `CounsellorProfile`, `LegalCounselProfile`, `NgoAdministratorProfile`, `ModeratorProfile`, `IncidentReport`, `EvidenceFile`, `LegalCaseFile`, `DirectChatChannel`, `DirectChatMessage`, `CommunityRoom`, `RoomMembership`, `CommunityMessage`, `HarmfulContentReport`, `ModerationActionLog`, `StaffReassignmentRequest`, `StaffAssignmentHistory`, `SupportResource`, `ResourceAccessEvent`, `OtpVerificationRequest`, `InAppNotification`, `AuditLog`, `UssdCallbackRequest`, `SystemSetting`.

`DirectChatMessage` now includes `deliveredAt` (DATE) and `seenAt` (DATE) for delivery and seen ticks.

#### Infrastructure (`backend/index.js`)
- Express 5 + `http.Server` shared with Socket.io.
- `ensureDatabaseExists()` auto-creates the MySQL database before Sequelize connects.
- `validateEnv()` fail-fast on missing required vars.
- `ensureSchemaCompatibility(sequelize)` runs on every boot after `sync()`.
- Proxy variable cleanup for WSL2 environments.
- `maintenanceGuard` middleware applied globally; allows `/api/health`, `/api/admin`, `/api/system/public-status`, OTP/password sign-in, and NGO_ADMIN-authenticated requests (the only admin role — bypasses maintenance mode).
- `loadMaintenanceStateFromDb()` called at boot to restore durable maintenance state from `SystemSetting`.

---

### 2.2 Frontend — Implemented

#### App Shell (`App.jsx`)
- Custom SPA router using `window.history.pushState` (no React Router dependency).
- Role-based route maps: NGO Admin and System Admin redirect to their dashboards.
- Auth guard: protected paths redirect to `/join` when unauthenticated.
- Maintenance mode screen: polls `/api/system/public-status` every 15 seconds.
- Quick Exit button: auto-collapses after 3s, clears auth + navigates to Google on activation.
- `/reports` removed from protected paths — emergency intercept renders for unauthenticated visitors instead of bouncing to `/join`.

#### Pages
- **LandingPage:** Introductory page for unauthenticated users.
- **AuthPage:** 3-step OTP-first signup (phone → OTP → password/profile details); password + mandatory-2FA signin (OTP is no longer a standalone alternative login method); forgot/reset password, forced first-login reset.
- **LibraryPage:** Resource browsing with category tabs and text search.
- **DirectChatPage:** Real-time E2EE direct chat; channel list with coloured presence dot (green/amber/grey) and `MessageTicks` component (✓ Sent → ✓✓ Delivered → ✓✓ Seen in blue). Archive/Restore/Delete action menu per channel. Separate Trash view (deleted channels only) lets survivors restore contact.
- **ReportingPage:** Report submission, evidence upload, report list, status tracking. Unauthenticated visitors see an emergency intercept screen offering Register or View Emergency Contacts (Police 999/112, Childline 116, GBV Hotline 1195). Legal counsel sees a structured drafting panel with four authoring fields, Save Draft, Generate Document, and Open Document.
- **CommunityPage:** Room list, join rooms, real-time community messaging with pseudonymous identities.
- **NgoAdminDashboardPage:** Command center (KPIs + trend chart), staffing, reports, moderation desk (internal tabs: Reports Queue / Banned Users), team capacity (with auto-suggested reassignment), USSD callbacks section (auto-assigned counsellor), resources, maintenance-mode toggle. NGO Admin is the only admin role — System Admin was removed.
- **ModerationDashboardPage:** Moderator's narrow view (Moderation Desk + Community Chat only); also reused as the NGO Admin's `/moderation` route.
- **ManageProfilePage:** Role-aware profile view and edit.

#### Notification Bell (`SiteHeader.jsx` → `NotificationBell`)
- Unread badge, 30s polling fallback, Socket.io push via `notificationSocket.js`.
- Dropdown: per-row mark-read + dismiss; "Mark all as read" bulk action.

#### E2EE (`cryptoUtils.js`)
- AES-GCM 256-bit via Web Crypto API; PBKDF2 key derivation from `chatId` as passphrase (fixed salt, 100k iterations, SHA-256).
- `encryptMessage` / `decryptMessage` with Base64 ciphertext + IV bundled as JSON.
- Server stores and relays only ciphertext; plaintext never leaves the client.
- Note: key is derived from chatId — not true ECDH. Acknowledged as a demo-grade implementation.

#### Services (`frontend/src/services/`)
- `admin.js` — NGO/system admin API calls, `banUser`, `unbanUser`.
- `reports.js` — report CRUD and evidence upload.
- `resources.js` — resource listing and management.
- `legalCases.js` — `saveLegalCaseDraft`, `updateLegalCaseStatus`, `generateLegalCaseDocument`, `getLegalCaseDocumentUrl`.

---

### 2.3 Testing

#### Backend Unit + Integration Tests (`backend/tests/`)
| File | Coverage |
|------|----------|
| `authController.test.js` | OTP lifecycle, password auth, lockout, signup flow |
| `banEnforcement.test.js` | `liftExpiredBan`, authMiddleware enforcement, ban guards (reason required, past expiry, admin target, self-ban), unban |
| `banCascade.test.js` | `cascadeReassignOnStaffBan` — reassigns survivors on COUNSELLOR/LEGAL_COUNSEL ban |
| `chatPresence.test.js` | 8 registry unit tests + 5 `markChannelRead` integration tests (seenAt, `message:seen` emission, no-unread guard) |
| `chatTrashRestore.test.js` | 16 tests for archive/restore/delete transitions and Trash view |
| `legalCaseController.test.js` | 20 cases: access control, field validation, status-transition rules, Cloudinary-not-configured guard (503), missing-document guard (404) |
| `notificationController.test.js` | List scoping, unread count, ownership enforcement, bulk-read, dismiss |
| `notificationService.test.js` | Notification write paths and socket push |
| `rbac.test.js` | Role-based access checks across endpoints |
| `reports.test.js` | Report state machine transitions, evidence upload, RBAC |
| `systemRoutes.test.js` | System-level routes and maintenance guard |
| `ussd.test.js` | USSD menu flow, callback-request creation |

#### E2E Tests (Playwright, `frontend/tests/e2e/`)
| File | Coverage |
|------|----------|
| `auth-flows.spec.js` | Signup, signin, password reset, forced password change |
| `survivor-flows.spec.js` | Report submission, community join, direct chat |
| `admin-flows.spec.js` | NGO admin dashboard operations, staff onboarding, moderation |
| `chat-trash-restore.spec.js` | 5 scenarios: archive, restore, delete, Trash view, staff visibility |
| `profile-library-flows.spec.js` | Profile edit, resource browsing |
| `safety.spec.js` | Emergency intercept, Quick Exit, maintenance mode |
| `system-smoke.spec.js` | Health checks, system admin operations |

---

### 2.4 Documentation

- `docs/pending-roadmap-items.md` — complete feature status tracker (all items Done).
- `backend/docs/auth-flow-reference.md` — auth flow reference.
- `backend/docs/authentication.md` — in-depth auth documentation.
- `backend/docs/server-bootup.md` — boot sequence documentation.
- `backend/docs/ussd.md` — USSD feature, menu tree, and local dev setup (ngrok).
- `backend/docs/manual-test-playbook.md` — manual testing playbook.
- `backend/README.md` and `frontend/README.md` — setup instructions.

---

## 3. How We Could Have Done Better

### 3.1 E2EE Key Exchange — Still Applies
The AES-GCM key is derived from `chatId` using PBKDF2 with a fixed salt. The server knows the chatId and could re-derive the key. A proper implementation requires ECDH: each user generates a key pair on their device, exchanges public keys through the server, and derives a shared secret locally. The server would only ever see public keys and ciphertext. This is the single remaining cryptographic gap.

### 3.2 OTP Storage — Fixed ✓
OTPs are now bcrypt-hashed (10 rounds) before storage. Both verification paths use `bcrypt.compare`. The `developmentOtp` field returns plaintext for local testing only.

### 3.3 State Management (Frontend) — Still Applies
No shared state management (no Context API, no Zustand). All state is component-local with prop drilling. For a project with role-aware routing, real-time socket events, auth state, and notification counts across multiple pages, a lightweight context or store (even React Context alone) would have reduced data re-fetching and state synchronisation bugs.

### 3.4 No React Router — Still Applies
The custom `window.history.pushState` SPA router lacks lazy loading, nested routes, scroll restoration, route parameter support (e.g., `/reports/:id`), and standard testing utilities. All routing is section-based within large page components as a consequence.

### 3.5 Test Coverage — Significantly Improved
Testing has grown from 1 file to 12 backend test files + 7 E2E specs. However:
- The backend test suite does not test socket events directly (chatSocket, communitySocket, notificationSocket).
- There are no tests for the full reassignment flow end-to-end.
- E2E tests depend on a live backend + seeded DB, making CI setup non-trivial.

### 3.6 Maintenance Mode Persistence — Fixed ✓
Maintenance state is now stored in the `SystemSetting` table and restored at boot via `loadMaintenanceStateFromDb()`. The `_maintenanceCache` keeps request-path fast. This survives process restarts.

### 3.7 Rate Limiting Scope — Still Applies
Rate limiting exists for auth endpoints (`authRateLimitMiddleware.js`) but is not applied globally. Evidence uploads, community message posting, and report creation should also be rate-limited. Express-rate-limit or a Redis-backed store (rate-limiter-flexible) should be applied at the route or controller level.

### 3.8 Role Normalisation Duplication — Fixed ✓
`backend/src/utils/roles.js` exports `normalizeRole` and `BANNABLE_ROLES`. All seven previous duplicates across controllers and services now import from this single source.

### 3.9 Tailwind CSS Not Actually Used — Still Applies
The frontend uses hand-written vanilla CSS (`index.css`, `App.css`). No Tailwind dependency is present. The gap between the stated stack and the actual implementation should be acknowledged in all project documents.

### 3.10 Input Sanitisation for Community Messages — Still Applies
`publicMessageContent` is stored and rendered without HTML sanitisation or markdown parsing. Depending on how the frontend renders it, stored XSS is possible if content is injected into `innerHTML`. `DOMPurify` on the frontend and server-side length+character validation would address this.

### 3.11 Cloudinary Dependency Without Graceful Degradation
When Cloudinary env vars are absent, upload and streaming endpoints return 503, but the error messages are inconsistent across controllers. A unified `cloudinaryAvailable()` guard and consistent 503 response shape would improve the development experience when Cloudinary is not configured.

---

## 4. What Is Yet to Be Done

All eight original roadmap items and the follow-up quality/security fixes are now complete. What remains is primarily production hardening, one open security gap, and coverage depth.

### 4.1 True ECDH Key Exchange (Security Enhancement)
**Status:** Not done. The current chatId-derived key is acknowledged as demo-grade.
**Impact:** Low immediate risk in a supervised deployment; high risk if deployed publicly. The server can re-derive the AES key from the chatId, so "end-to-end" encryption is not cryptographically guaranteed.

### 4.2 Global Rate Limiting
**Status:** Auth endpoints rate-limited; other endpoints are not.
**Missing:** Rate limits on evidence upload, community posting, report creation, and all admin write endpoints. Without this, a logged-in account can flood the DB or Cloudinary storage.

### 4.3 Input Sanitisation for Community Messages
**Status:** No sanitisation.
**Missing:** Server-side content length/character validation; `DOMPurify` (or similar) on the frontend before rendering community message content.

### 4.4 Socket.io Test Coverage
**Status:** Socket handlers (`chatSocket.js`, `communitySocket.js`) are not unit or integration tested.
**Missing:** Tests for presence broadcast, delivery catch-up on reconnect, `sendEncryptedMessage` persistence, `message:seen` emission, and ban socket revocation.

### 4.5 Production Deployment Hardening
**Status:** Not addressed.
**Missing:**
- PM2 or similar process manager config (`ecosystem.config.js`) for process supervision and restart.
- Nginx reverse-proxy config (HTTPS termination, `proxy_pass` to port 5000, WebSocket `Upgrade` headers).
- Production `NODE_ENV=production` guards (ensure `SKIP_SMS_IN_DEV` and `developmentOtp` paths are completely disabled).
- `helmet.js` for HTTP security headers.
- Environment secrets management (not in `.env` on disk — use a secrets manager or environment injection).

### 4.6 Seeder Comprehensiveness
**Status:** Seeder exists but its scope is limited to core demo paths.
**Missing:** Representative multi-state scenarios: reports in every status, a legal case with a generated PDF, banned users, an active USSD callback request, community messages with pending moderation reports. A richer seeder removes the need to manually set up state for every testing session.

---

## 5. How to Do What's Yet to Be Done

### 5.1 True ECDH E2EE Key Exchange

Replace the chatId-derived key with a per-user ECDH key pair. This is a multi-part change:

**Backend — new profile endpoints:**
```
POST /api/profile/public-key     → store user's ECDH public key (JWK format)
GET  /api/profile/:userId/public-key → return counterpart's public key
```
Add a `ecdhPublicKeyJwk` TEXT column to `UserAccount` (or a separate `UserKeyRecord` table to allow key rotation).

**Frontend — key generation and exchange (`cryptoUtils.js`):**
```js
// Generate key pair once per session after login
const keyPair = await window.crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  false, // private key non-extractable
  ['deriveKey']
);
// Export public key and POST to /api/profile/public-key
const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);

// Before opening a channel, fetch counterpart's public key
const theirPublicKey = await window.crypto.subtle.importKey(
  'jwk', fetchedJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []
);

// Derive shared AES-GCM key — never leaves the device
const sharedKey = await window.crypto.subtle.deriveKey(
  { name: 'ECDH', public: theirPublicKey },
  keyPair.privateKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
```
Replace `getSharedKey(chatId)` calls with the derived `sharedKey`. The server never sees the shared secret.

**Note:** Store the private key in memory only (not localStorage) — it is regenerated each session. For persistent history across sessions, an additional key-wrapping layer (encrypt private key with a PIN-derived key) is needed.

### 5.2 Global Rate Limiting

Install `express-rate-limit` and apply at the router level:

```js
// backend/src/middleware/rateLimitMiddleware.js
const rateLimit = require('express-rate-limit');

const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Upload rate limit exceeded.' }
});

module.exports = { standardLimiter, uploadLimiter };
```

Apply in `backend/index.js`:
```js
const { standardLimiter } = require('./src/middleware/rateLimitMiddleware');
app.use('/api', standardLimiter); // global default
```
Apply `uploadLimiter` specifically to `POST /api/reports/:id/evidence` and `POST /api/resources` routes.

### 5.3 Community Message Sanitisation

**Backend (`communityController.js`):** Add a content guard before saving:
```js
const MAX_MESSAGE_LENGTH = 2000;
if (!content || typeof content !== 'string' || content.trim().length === 0) {
  return res.status(400).json({ error: 'Message content is required.' });
}
if (content.length > MAX_MESSAGE_LENGTH) {
  return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit.` });
}
```

**Frontend (`CommunityPage.jsx`):** Install `dompurify` and sanitise before rendering:
```js
import DOMPurify from 'dompurify';
// When rendering message content:
<span>{DOMPurify.sanitize(message.publicMessageContent)}</span>
```
Always use text content (not `dangerouslySetInnerHTML`) for user-generated text — this is the safest default.

### 5.4 Socket.io Integration Tests

Use `socket.io-client` in Jest to test socket handlers against a real in-memory server:

```js
// backend/tests/chatSocket.test.js
const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

describe('chatSocket', () => {
  let io, serverSocket, clientSocket;
  beforeAll((done) => {
    const httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = new Client(`http://localhost:${port}`, {
        auth: { token: validJwt }
      });
      io.on('connection', (socket) => { serverSocket = socket; });
      clientSocket.on('connect', done);
    });
  });

  test('joinChannel emits error for non-member', (done) => {
    clientSocket.emit('joinChannel', { chatId: 'non-existent' });
    clientSocket.on('messageError', (err) => {
      expect(err.message).toMatch(/access/i);
      done();
    });
  });
});
```
Write tests for: `joinChannel` membership gate, `sendEncryptedMessage` persistence, delivery catch-up on reconnect, `presence:update` broadcast, ban socket revocation.

### 5.5 Production Deployment

**PM2 (`backend/ecosystem.config.js`):**
```js
module.exports = {
  apps: [{
    name: 'gbv-backend',
    script: './index.js',
    cwd: '/var/www/gbv/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000
    }
  }]
};
```

**Nginx (`/etc/nginx/sites-available/gbv`):**
```nginx
server {
  listen 443 ssl;
  server_name gbv.yourdomain.ke;

  location /api/ {
    proxy_pass http://localhost:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  location / {
    root /var/www/gbv/frontend/dist;
    try_files $uri /index.html;
  }
}
```

**Security headers (`backend/index.js`):**
```js
const helmet = require('helmet');
app.use(helmet());
```

**Production environment checklist:**
- `NODE_ENV=production`
- `SKIP_SMS_IN_DEV` absent or `false`
- `DB_SYNC_ALTER=false` (stable schema)
- `JWT_SECRET` is a 64-byte random string, not a memorable phrase
- Cloudinary vars set and tested
- MySQL user has only `SELECT/INSERT/UPDATE/DELETE` on the GBV database (no `DROP/CREATE`)

### 5.6 Seeder Expansion

Expand `backend/src/seeders/index.js` to seed:
- At least one report in every status (SUBMITTED, UNDER_REVIEW, ACTIVE_SUPPORT, UNDER_INVESTIGATION, LEGAL_REVIEW, ESCALATED_TO_LEGAL_CASE, RESOLVED).
- A legal case with `caseSummary` drafted, `documentGeneratedAt` set, and a mock `generatedDocumentPublicId`.
- A banned survivor with `banReason` and `bannedAt` set, visible in the Banned Users registry.
- An active `UssdCallbackRequest` so the NGO admin callback queue is non-empty on first boot.
- Three community messages in the General Support room, one with a pending `HarmfulContentReport`, so the moderation desk is non-empty.

---

## 6. Suggested Implementation Order for Remaining Work

| Priority | Item | Effort | Rationale |
|----------|------|--------|-----------|
| 1 | Community message sanitisation | 2–4 hours | Low effort, security hygiene, should go before any public access |
| 2 | Global rate limiting | 4 hours | Prevents abuse with minimal code surface |
| 3 | Production deployment config | 1–2 days | Needed before any real-user traffic |
| 4 | Seeder expansion | 4–8 hours | Accelerates manual testing and demo readiness |
| 5 | Socket.io test coverage | 2–3 days | Closes the largest testing gap |
| 6 | ECDH key exchange | 3–4 days | Security enhancement; lower priority for supervised demo, required for public launch |

---

## Appendix: File Map

```
CSProject/
├── backend/
│   ├── index.js                              # Bootstrap: DB create, sync, schemaCompat, routes, sockets
│   ├── ecosystem.config.js                   # PM2 config (to be created for production)
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js                   # Sequelize instance
│   │   │   └── cloudinary.js                 # Config + upload/stream helpers (fetchPrivateAssetStream)
│   │   ├── controllers/
│   │   │   ├── authController.js             # OTP (bcrypt-hashed), password, JWT, auto-assignment
│   │   │   ├── reportController.js           # Report CRUD, evidence proxy, status machine, analytics
│   │   │   ├── chatController.js             # Channels (presence-aware), messages, archive/delete
│   │   │   ├── communityController.js        # Rooms, messages, moderation (ban_user/warn/remove)
│   │   │   ├── adminController.js            # NGO+system dashboards, maintenance, banning, cascade
│   │   │   ├── resourceController.js         # Resource library CRUD + Cloudinary proxy
│   │   │   ├── profileController.js          # Per-role profile view + edit
│   │   │   ├── notificationController.js     # Notification list, read, dismiss endpoints
│   │   │   ├── legalCaseController.js        # Draft, status, PDF generate, stream proxy
│   │   │   ├── ussdController.js             # AT USSD callback + NGO fulfillment queue
│   │   │   └── reassignmentRequestController.js
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js             # JWT verify + DB lookup (ban/suspend enforcement)
│   │   │   └── authRateLimitMiddleware.js
│   │   ├── models/                           # 25 Sequelize models (see Section 2.1)
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── reportRoutes.js
│   │   │   ├── chatRoutes.js
│   │   │   ├── communityRoutes.js
│   │   │   ├── adminRoutes.js
│   │   │   ├── resourceRoutes.js
│   │   │   ├── profileRoutes.js
│   │   │   ├── notificationRoutes.js
│   │   │   ├── legalCaseRoutes.js
│   │   │   ├── ussdRoutes.js
│   │   │   └── reassignmentRequestRoutes.js
│   │   ├── services/
│   │   │   ├── chatAccessService.js          # Channel membership + auto-provisioning
│   │   │   ├── notificationService.js        # Single write path for all in-app notifications
│   │   │   ├── presenceRegistry.js           # In-memory userId→Set<socketId> singleton
│   │   │   └── legalDocumentService.js       # pdfkit PDF generation in memory
│   │   ├── sockets/
│   │   │   ├── chatSocket.js                 # E2EE direct chat: presence, delivery, seen, ban guard
│   │   │   └── communitySocket.js            # Community rooms: join/leave, broadcast, moderation events
│   │   ├── utils/
│   │   │   ├── roles.js                      # normalizeRole + BANNABLE_ROLES (single source)
│   │   │   └── schemaCompatibility.js        # Boot-time idempotent ENUM/column DDL guards
│   │   └── seeders/index.js
│   ├── tests/
│   │   ├── authController.test.js
│   │   ├── banEnforcement.test.js
│   │   ├── banCascade.test.js
│   │   ├── chatPresence.test.js
│   │   ├── chatTrashRestore.test.js
│   │   ├── legalCaseController.test.js
│   │   ├── notificationController.test.js
│   │   ├── notificationService.test.js
│   │   ├── rbac.test.js
│   │   ├── reports.test.js
│   │   ├── systemRoutes.test.js
│   │   └── ussd.test.js
│   └── docs/
│       ├── auth-flow-reference.md
│       ├── authentication.md
│       ├── server-bootup.md
│       ├── ussd.md
│       └── manual-test-playbook.md
├── frontend/
│   └── src/
│       ├── App.jsx                           # SPA shell, routing, maintenance, Quick Exit
│       ├── App.css                           # Presence dots, message ticks, legal draft panel styles
│       ├── components/
│       │   ├── SiteHeader.jsx                # Nav + NotificationBell
│       │   └── AdminWorkspace.jsx
│       ├── pages/
│       │   ├── AuthPage.jsx
│       │   ├── DirectChatPage.jsx            # E2EE chat, presence dot, message ticks, trash view
│       │   ├── ReportingPage.jsx             # Reports, emergency intercept, legal drafting panel
│       │   ├── CommunityPage.jsx
│       │   ├── LibraryPage.jsx
│       │   ├── NgoAdminDashboardPage.jsx     # Includes ModerationDeskSection (Reports/Banned tabs)
│       │   ├── ModerationDashboardPage.jsx   # Moderator's narrow view; also NGO Admin's /moderation route
│       │   └── ManageProfilePage.jsx
│       ├── services/
│       │   ├── admin.js
│       │   ├── reports.js
│       │   ├── resources.js
│       │   └── legalCases.js
│       ├── utils/cryptoUtils.js              # AES-GCM encrypt/decrypt (Web Crypto API)
│       └── data/fallbackResources.js
│   └── tests/e2e/
│       ├── auth-flows.spec.js
│       ├── survivor-flows.spec.js
│       ├── admin-flows.spec.js
│       ├── chat-trash-restore.spec.js
│       ├── profile-library-flows.spec.js
│       ├── safety.spec.js
│       └── system-smoke.spec.js
└── docs/
    └── pending-roadmap-items.md              # All items now Done
```
