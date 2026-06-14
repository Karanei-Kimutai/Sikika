# GBV Support Platform — Project Analysis

**Project:** Gender-Based Violence (GBV) Support Platform for Kenya
**Stack:** React 19 + Tailwind CSS (frontend) · Node.js + Express 5 + Socket.io (backend) · MySQL + Sequelize (database) · Africa's Talking (USSD + SMS OTP) · Cloudinary (file storage)
**Methodology:** Agile Scrum + OOAD

---

## 1. Everything That Must Be Done to Achieve the Goal

The goal, as defined in the System Design Document and proposal, is a **dual-channel (Web + USSD), survivor-centred GBV support platform** for Kenyan survivors, with six user roles, real-time communication, evidence management, legal escalation, and NGO oversight.

### 1.1 Core Functional Requirements

| Module | What Needs to Exist |
|--------|---------------------|
| Authentication | OTP-based phone verification, password auth, forgot/reset password, JWT sessions, lockout protection, role-based access |
| Incident Reporting | Report submission, evidence upload, status state machine (7 states), staff status transitions, legal escalation with consent |
| Direct Chat (E2EE) | Auto-provisioned channels per assignment, encrypted message relay, read receipts, archive/delete, real-time via Socket.io |
| Community Rooms | Moderated peer rooms, pseudonymous identities, message reporting, moderation review (warn/suspend/remove), real-time via Socket.io |
| Resource Library | Public browsable library, staff upload/edit/delete, Cloudinary storage, category + search filter |
| USSD Interface | Africa's Talking callback, menu flow for callback request vs. hotline, session persistence, report via USSD |
| NGO Admin Dashboard | Staffing workload, survivor assignments, reassignment, staff onboarding, resource management, analytics, moderation queue |
| System Admin Dashboard | Maintenance mode, audit logs, server runtime actions, infra health, staff directory |
| Notifications | In-app notification center, read/dismiss, discreet copy, fan-out on report/chat events |
| Profile Management | Per-role profile view and edit (survivor nickname/county/gender, staff specialization/availability) |
| Staff Reassignment | Survivor-driven requests, NGO review/approval, auto-pick replacement, workload refresh |
| Legal Case Workflow | Legal case file creation, escalation with survivor consent, document path, case status tracking |
| RBAC | Six roles: Survivor, Counsellor, Legal Counsel, NGO Admin, System Admin, (unregistered visitor) |
| Safety UX | Quick Exit button, maintenance screen, emergency contacts for unauthenticated users |
| Emergency Intercept | Soft intercept when unauthenticated user tries to report, offering Register or View Emergency Contacts |
| Banning | BAN/BANNED lifecycle state separate from suspension, ban history, NGO admin workflow |
| Analytics | Report trends, by category/status/county/severity, average response time, resource access tracking |
| Testing | Auth controller unit tests exist; integration and E2E test coverage needed across all modules |
| USSD | Full Africa's Talking USSD session handler and menu state machine |
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
- **Africa's Talking SMS:** Real OTP SMS delivery in non-dev mode; `SKIP_SMS_IN_DEV=true` bypasses it for local testing and returns the OTP in the response.
- **Auto-assignment on Signup:** On OTP verification (first time), a `SurvivorProfile` is created, the least-loaded counsellor and legal counsel are auto-assigned (by `currentWorkloadScore` + `availabilityStatus`), and direct-chat channels are provisioned — all in a single Sequelize transaction.
- **JWT:** 2-hour tokens signed with `JWT_SECRET`, containing `userId` and `role`.

#### Incident Reporting (`reportController.js`, `reportRoutes.js`)
- Full CRUD for survivors on their own reports.
- Evidence upload to Cloudinary via `multer` with UUID filenames; signed URL generation and refresh on access (5-minute TTL).
- Status state machine with 7 states: SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE / RESOLVED / WITHDRAWN.
- Role-scoped status transition permissions: counsellors, legal counsel, and NGO admins each have separate allowed sets.
- Legal case auto-creation on LEGAL_REVIEW or ESCALATED_TO_LEGAL_CASE transitions; survivor consent required for escalation.
- Analytics endpoint (NGO admin only): totals, by status/category/severity/county, 30-day trend by date, legal cases by status.
- Fan-out in-app notifications to all report stakeholders (survivor + assigned staff + all NGO admins) on report events.

#### Direct Chat (`chatController.js`, `chatSocket.js`, `chatAccessService.js`)
- `GET /api/chat/channels` returns active channels for the logged-in user (survivor side or staff side), with unread counts, counterpart role, and staff availability.
- `GET /api/chat/channels/:chatId/messages` returns ordered message history and marks messages read.
- `PATCH /api/chat/channels/:chatId/status` lets survivors archive, restore, or delete their own channels.
- `POST /api/chat/channels/:chatId/read` clears unread badge.
- Socket.io `chatSocket.js`: JWT-authenticated WebSocket; `joinChannel` event (membership-gated) and `sendEncryptedMessage` event persist opaque encrypted payloads without server-side decryption. Notifications are sent to other channel participants.
- Channel auto-provisioning (`ensureAutoChannelsForSurvivor`) creates one channel per assigned staff member, idempotently, whenever channels are fetched.

#### Community (`communityController.js`, `communitySocket.js`, `communityRoutes.js`)
- 4 default rooms seeded idempotently on first rooms request: General Support, Legal Guidance, Emotional Support, Safety Planning.
- Join/leave membership. Auto-join on first post.
- Message history (membership-gated). Non-production demo message seeder for empty rooms.
- Privacy-safe display identities: survivors use their nickname, staff get role badges.
- Harmful content report filing (self-report blocked).
- Moderation review (NGO admin): approve/reject + actions: `remove_message`, `ban_user` (sets BANNED + reason + optional expiry + dual audit trail, resolves report atomically), `issue_warning` — all in a DB transaction with audit log entries and Socket.io real-time events. The legacy `suspend_user`/`block_user` moderation actions have been removed.
- NGO admin can also delete any message directly (audit-logged).

#### NGO Admin (`adminController.js`, `adminRoutes.js`)
- **Dashboard:** Massive parallel query returning: overview metrics, 30-day report trend, reports breakdown (by category/status/county), community metrics, staff workload (counsellors + legal counsel), staff directory, survivor assignment list, recent urgent cases, moderation queue, resource list + analytics, average response time (computed from message timestamps).
- **Resource management:** Create and update support resources (title, category, fileUrl). NGO resources created here use a URL reference; actual file uploads are handled via `resourceController`.
- **Survivor reassignment:** NGO admin manual override with assignment history write, direct-chat channel resync, and workload score refresh.
- **Staff onboarding:** `createStaffAccount` (counsellor/legal counsel) with temp password, `password_reset_required` status, and audit log — transactional.
- **Staff account status:** Suspend/reactivate counsellors and legal counsel.
- **Global search:** Cross-entity search by report ID or phone number/user ID.
- **System dashboard:** DB health, SMS config status, server uptime, audit log, admin directory, staff directory.
- **Maintenance mode:** Toggle on/off with reason and ETA; `maintenanceGuard` middleware blocks all non-recovery endpoints.
- **Runtime actions:** `CLEAR_CACHE` and `RESTART_SERVER` (restart is opt-in via `ALLOW_ADMIN_RESTART`).
- **System audit logs:** Streaming audit events with optional `since` timestamp for incremental polling.

#### Resource Library (`resourceController.js`, `resourceRoutes.js`)
- Public read (no auth required): list resources with optional category filter and text search across title/description/category.
- Staff upload (counsellor/legal counsel/NGO admin): Cloudinary upload (PDF, DOC, DOCX, TXT, image, audio, video), metadata persisted.
- Update: metadata-only or file replacement; old Cloudinary asset deleted after new save.
- Delete: DB row removed then Cloudinary cleanup.

#### Profile (`profileController.js`, `profileRoutes.js`)
- `GET /api/profile/me`: Returns user account + role-specific profile + assigned staff details (for survivors).
- `PATCH /api/profile/me`: Role-aware partial update — survivor can change nickname/county/gender/privacy prefs; staff can update specialization and availability status; NGO admin can update department.

#### Staff Reassignment Requests (`reassignmentRequestController.js`, `reassignmentRequestRoutes.js`)
- Survivor creates a request (scope: COUNSELLOR / LEGAL_COUNSEL / BOTH) with a reason, one pending at a time.
- Survivor can cancel pending requests.
- NGO admin lists requests (filterable by status) with survivor metadata hydration.
- NGO admin approves/rejects; approval picks least-loaded replacement (excluding current staff) and calls `applySurvivorReassignment` which writes history, refreshes channels, and updates workload.

#### Data Models (Sequelize, all in `backend/src/models/`)
All 20+ entities are defined:
`UserAccount`, `SurvivorProfile`, `CounsellorProfile`, `LegalCounselProfile`, `NgoAdministratorProfile`, `SystemAdministratorProfile`, `IncidentReport`, `EvidenceFile`, `LegalCaseFile`, `DirectChatChannel`, `DirectChatMessage`, `CommunityRoom`, `RoomMembership`, `CommunityMessage`, `HarmfulContentReport`, `ModerationActionLog`, `StaffReassignmentRequest`, `StaffAssignmentHistory`, `SupportResource`, `ResourceAccessEvent`, `OtpVerificationRequest`, `InAppNotification`, `AuditLog`, `UssdCallbackRequest`.

#### Infrastructure (`backend/index.js`)
- Express 5 app + `http.Server` (shared with Socket.io).
- Auto-creates the MySQL database if it doesn't exist (`ensureDatabaseExists`).
- Sequelize `sync()` on startup (optional `alter: true` via `DB_SYNC_ALTER` env flag).
- Env validation with fail-fast messaging before server starts.
- Proxy variable cleanup for WSL2 environments.
- CORS configured from `FRONTEND_ORIGIN`.
- Auth rate limiting middleware (`authRateLimitMiddleware.js`).

### 2.2 Frontend — Implemented

#### App Shell (`App.jsx`)
- Custom SPA router using `window.history.pushState` (no React Router dependency).
- Role-based route remapping: NGO Admin and System Admin have their own route maps that point their paths to the relevant dashboard sections.
- Auth guard: protected paths redirect to `/join` when unauthenticated.
- Maintenance mode screen: polls `/api/system/public-status` every 15 seconds and shows a maintenance card for non-system-admin sessions.
- Quick Exit button: collapses after 3 seconds of inactivity; clicking clears auth state and navigates to Google.

#### Pages
- **LandingPage:** Introductory page for unauthenticated users.
- **AuthPage:** OTP signup and signin, password login, forgot/reset password flows.
- **LibraryPage:** Resource browsing with category tabs and search.
- **DirectChatPage:** Real-time E2EE direct chat with Socket.io; channel list and message view.
- **ReportingPage:** Report submission, evidence upload, report list, status tracking.
- **CommunityPage:** Room list, join rooms, real-time community messaging with pseudonymous identities.
- **ModerationDashboardPage:** Moderation queue (NGO admin view).
- **NgoAdminDashboardPage:** Full NGO dashboard: command center, staffing, reports, moderation, team capacity, resources.
- **SystemAdminDashboardPage:** System admin dashboard: infrastructure, maintenance, audit logs, access directory.
- **ManageProfilePage:** Role-aware profile view and edit.

#### E2EE (`cryptoUtils.js`)
- AES-GCM 256-bit encryption using the Web Crypto API (PBKDF2 key derivation from chatId as passphrase).
- `encryptMessage` / `decryptMessage` with Base64-encoded ciphertext + IV bundled as JSON.
- Note: Uses chatId-derived key as a demo of the E2EE flow; not a full ECDH key exchange.

#### Services (`frontend/src/services/`)
- `admin.js`: NGO/system admin API calls.
- `reports.js`: Report CRUD and evidence upload.
- `resources.js`: Resource listing and management.

#### Fallback Data
- `fallbackResources.js`: Static resource data shown when the backend is unreachable.

### 2.3 Testing
- `backend/tests/authController.test.js`: Unit tests for the authentication controller using Jest + Supertest.
- Test scripts configured in `package.json`: `npm test`, `npm run test:watch`, `npm run test:auth`.
- One test file only; no tests for other controllers or the frontend.

### 2.4 Documentation
- `backend/docs/auth-flow-reference.md`: Auth flow reference.
- `backend/docs/manual-test-playbook.md`: Manual testing playbook.
- `docs/pending-roadmap-items.md`: Detailed status of incomplete features (maintained accurately).
- `backend/README.md` and `frontend/README.md`: Setup instructions.

---

## 3. How We Could Have Done Better

### 3.1 E2EE Key Exchange
The current implementation derives the AES-GCM key from the `chatId` using PBKDF2 with a fixed salt. This is not true end-to-end encryption — the server knows the chatId and could in principle re-derive the key. A proper implementation would use ECDH (Elliptic Curve Diffie-Hellman): each user generates a key pair on their device, exchanges public keys through the server, and derives a shared secret locally. The server would only ever see public keys and ciphertext, never the shared secret.

### 3.2 OTP Storage
OTPs are stored as **plaintext** in the `otpHash` column. The column is named "hash" but the value is stored raw for comparison (`user.otpHash !== otp`). OTPs should be hashed with bcrypt or at minimum a fast hash like SHA-256 before storage, so a database breach does not expose live codes.

### 3.3 State Management (Frontend)
The frontend has no shared state management (no Context API, no Zustand, no Redux). State is entirely component-local, which means props are drilled deeply and data is re-fetched in multiple places. For a project of this complexity (role-aware routing, real-time socket events, auth state, notification counts), a lightweight context or store would have reduced duplication and bugs.

### 3.4 No React Router
The app implements its own SPA router with `window.history.pushState`. While clever, this lacks lazy loading, nested routes, scroll restoration, and the testing support that `react-router-dom` provides out of the box. The custom router also has no support for route parameters (e.g., `/reports/:id`), which has forced all routing to be section-based within single large pages.

### 3.5 Test Coverage
Only `authController.test.js` exists. A GBV platform with a state machine (report statuses), strict RBAC, financial implications (legal escalation), and sensitive evidence should have full integration tests for every controller, covering happy paths and security boundaries. The testing setup exists (Jest + Supertest) but was barely used.

### 3.6 Maintenance Mode Is Process-Local
Maintenance mode state is stored in memory variables in `adminController.js`. This means if the Node process restarts, maintenance mode is lost. For production, this flag should be persisted in the database or a shared store (Redis), so it survives restarts and can be shared across multiple server instances.

### 3.7 Rate Limiting Scope
Auth rate limiting middleware exists (`authRateLimitMiddleware.js`) but rate limiting is not applied globally to all endpoints. Endpoints like evidence upload, community message posting, and report creation should also be rate-limited to prevent abuse.

### 3.8 Role Normalisation Duplication
Every controller has its own copy of the `normalizeRole` function. This is a utility that belongs in a shared `utils/` module and imported once, following DRY principles.

### 3.9 Tailwind CSS Not Actually Used
The `package.json` lists no Tailwind dependency — the frontend uses vanilla CSS (`index.css`, `App.css`). The project description and design docs reference Tailwind, but it was not integrated. The CSS is hand-written and not utility-first. This is fine, but the gap between the stated stack and the actual stack should be reconciled.

### 3.10 No Input Sanitisation for Community Messages
Community message content (`publicMessageContent`) is stored and rendered as-is. There is no HTML sanitisation or markdown parsing. Depending on how the frontend renders it, XSS may be possible if content is injected into `innerHTML`. The frontend should use safe text rendering and the backend should consider content validation.

### 3.11 Seeder Coverage
The seeder (`backend/src/seeders/index.js`) exists but the scope of seeded data is unclear. A more comprehensive seeder with representative multi-role scenarios (survivor, counsellor, legal counsel, NGO admin, reports in various states, community messages, legal cases) would accelerate manual testing significantly.

---

## 4. What Is Yet to Be Done

The following is drawn from `docs/pending-roadmap-items.md` and analysis of the codebase against the SSD v1.3.

### 4.1 USSD Interface (Partial — Major Gap)
**What exists:** The `UssdCallbackRequest` data model and Africa's Talking SMS integration (OTP) exist.
**What is missing:**
- A live USSD endpoint (e.g., `POST /api/ussd/callback`) that receives Africa's Talking USSD session data.
- A menu state machine: Welcome → Option A (Request Callback) / Option B (Hotline Numbers) → confirmation messages.
- Session state persistence (USSD sessions are stateless; state must be stored in DB or Redis between requests).
- Writing `UssdCallbackRequest` records from actual USSD traffic.
- Hotline number return flow.

### 4.2 Emergency Intercept for Unregistered Users (Not Done)
**What exists:** Unauthenticated users can browse the landing page and library.
**What is missing:**
- When an unauthenticated user navigates to `/reports`, instead of a plain redirect to `/join`, they should see a dedicated intercept screen with two explicit choices: **Register Now** (to join and report) or **View Emergency Contacts** (for immediate crisis support).
- Emergency contacts should be surfaced prominently: Police (999/112), Childline Kenya (116), National GBV Hotline (1195).

### 4.3 In-App Notification Center (Partial)
**What exists:** `InAppNotification` model with `UNREAD`/`READ` status. Notifications are written in chat and report flows with discreet copy.
**What is missing:**
- API endpoints: `GET /api/notifications` (list), `PATCH /api/notifications/:id/read` (mark read), `DELETE /api/notifications/:id` (dismiss).
- Frontend notification center: bell icon in the header with unread count badge, dropdown or drawer with notification list, mark read on click, dismiss action.
- Dismissible state (distinct from read state) as described in the roadmap.

### 4.4 User Banning Workflow (Partial)
**Status: Done.** Full ban workflow implemented with `BANNED` account status (distinct from `SUSPENDED`), `PATCH /api/admin/ngo/users/:userId/ban` and `/unban` endpoints, ban metadata columns (`banReason`, `banExpiresAt`, `bannedByUserId`, `bannedAt`), dual audit trail (ModerationActionLog + AuditLog), automatic ban expiry lift at next auth check (`liftExpiredBan`), and cascading survivor reassignment when a COUNSELLOR/LEGAL_COUNSEL is banned (`cascadeReassignOnStaffBan`). Moderation `ban_user` action resolves the underlying content report atomically.
- Frontend visibility: banned status indicator in user management surfaces, ban/unban controls.

### 4.5 Legal Case Document Drafting and Export (Partial)
**What exists:** `LegalCaseFile` model with `generatedDocumentPath` field. Legal case status tracking. Reporting UI surfaces legal case details.
**What is missing:**
- A structured case document authoring workflow for legal counsel — a form or UI to fill in case details that generates/exports a document.
- An explicit handover workflow (e.g., download generated case document, export to external legal system).

### 4.6 Explicit Staff Presence Indicators (Partial)
**What exists:** `availabilityStatus` on counsellor/legal counsel profiles (AVAILABLE/BUSY/OFFLINE). `asyncDeliveryHint` is returned in the chat channel list when staff is OFFLINE. NGO admin dashboard surfaces availability.
**What is missing:**
- A visible online/offline indicator in the direct chat UI (green/grey dot next to the counterpart's name or channel header).
- Explicit UX language in the chat window when the recipient is offline (e.g., "Your message will be delivered when [Counsellor] returns").
- Socket.io presence events so online/offline status updates in real-time (currently only refreshed on channel list fetch).

### 4.7 Average Response Time Analytics (Partially Done)
**What exists:** The `computeAverageStaffResponseMinutes` function exists in `adminController.js` and is returned in the NGO dashboard payload.
**What is missing:**
- Frontend visualization of average response time on the NGO dashboard (it is computed but may not be rendered yet).
- Per-staff breakdown of average response time (currently aggregate only).

### 4.8 Survivor Chat Archive/Delete Frontend Controls (Not Done)
**What exists:** `PATCH /api/chat/channels/:chatId/status` endpoint supports `active`, `archived`, `deleted` transitions.
**What is missing:**
- Frontend actions for archive, restore, and delete in the direct chat page (no UI controls currently visible to survivors).

### 4.9 Integration and E2E Testing
**What exists:** One auth controller test file.
**What is missing:**
- Integration tests for all controllers (report workflow, chat access, community moderation, admin operations, reassignment).
- E2E tests covering full user journeys: survivor signup → report → evidence upload → legal escalation; NGO admin → staff creation → survivor reassignment.

### 4.10 USSD Notification (Not Done)
When a survivor without smartphone access leaves a callback request via USSD, there is no mechanism to notify NGO admins of the new callback request. An in-app notification and/or an SMS alert to admin should be triggered.

---

## 5. How to Do What's Yet to Be Done

### 5.1 Emergency Intercept (Highest Priority — Safety)

**Frontend (`ReportingPage.jsx`):**
```
If user is not authenticated, instead of just rendering the AuthPage redirect,
render an intercept screen:
  - Headline: "To report an incident, you need an account"
  - Button 1: "Create Account" → navigate('/join') with signup intent
  - Button 2: "View Emergency Contacts" → show modal with 999/112, 116, 1195
  - Small link: "I already have an account — Sign In"
```
This is a pure frontend change. The backend already returns emergency contacts in the report creation 401 response (`getEmergencyContactsResponse`).

### 5.2 USSD Interface

**Backend — new file `backend/src/controllers/ussdController.js`:**
1. Register `POST /api/ussd/callback` in a new `ussdRoutes.js` (no auth middleware — Africa's Talking calls it directly).
2. Parse the Africa's Talking USSD POST body: `{ sessionId, serviceCode, phoneNumber, text }`.
3. Use `text` to determine menu depth:
   - Empty → Level 1: "CON Welcome to GBV Support\n1. Request Callback\n2. Emergency Hotlines"
   - "1" → Level 2: "CON Enter a brief description of your need (or press 0 to skip)\n0. Skip"
   - "1*[description]" or "1*0" → Level 3: Create `UssdCallbackRequest` record, send `END Your callback request has been received. A support worker will contact you.`
   - "2" → Level 2: `END Emergency Contacts:\nPolice: 999/112\nChildline: 116\nGBV Hotline: 1195`
4. Use a simple switch on `text.split('*')` for state — USSD sessions from Africa's Talking concatenate all inputs with `*`.
5. Return response as plain text with `Content-Type: text/plain`.

**Environment:** Add `AFRICASTALKING_USSD_CODE` to `.env`.

### 5.3 In-App Notification Center

**Backend — new routes in `authRoutes.js` or a new `notificationRoutes.js`:**
```
GET  /api/notifications          → list for authenticated user, latest first
PATCH /api/notifications/:id/read → set notificationReadStatus = 'READ'
DELETE /api/notifications/:id    → destroy row (dismiss)
GET  /api/notifications/unread-count → { count: N } for badge polling
```
Keep notifications lightweight — no pagination needed unless the product grows.

**Frontend:**
1. Add a bell icon to `SiteHeader.jsx`. Poll `/api/notifications/unread-count` every 30 seconds (or emit via Socket.io when a new notification is created).
2. On click, fetch and show a dropdown/drawer with the list.
3. On item click, mark as read and navigate to the relevant section (e.g., report detail, chat).
4. Add a dismiss (×) button per item.

### 5.4 User Banning

**Backend:**
1. Add `BANNED` as a valid `accountStatus` value in the `UserAccount` model.
2. Add a `banReason` and `banExpiresAt` (nullable for permanent) column to `UserAccount`.
3. New endpoints in `adminRoutes.js`:
   - `POST /api/admin/users/:userId/ban` (NGO admin): set `accountStatus = 'BANNED'`, write `banReason`, optionally set `banExpiresAt`, write `AuditLog`.
   - `POST /api/admin/users/:userId/unban` (NGO admin): set `accountStatus = 'ACTIVE'`, clear ban fields, write `AuditLog`.
4. Update `isAccountActive()` in `authController.js` to also block `BANNED` accounts.
5. ~~Update moderation `suspend_user` to remain as a temporary suspension~~ — **Done:** moderation now uses `ban_user` (BANNED + metadata + dual audit). The `suspend_user`/`block_user` moderation paths have been removed. `SUSPENDED` is reserved for the reversible Active/Inactive operational staff toggle only.

**Frontend:** Add ban/unban buttons to the staff directory and user management tables in `NgoAdminDashboardPage.jsx`, with a confirmation modal that collects the ban reason.

### 5.5 Legal Case Document Drafting

**Backend — extend `reportController.js` / `adminController.js`:**
1. Add `PATCH /api/reports/:reportId/legal-case` (legal counsel only): accept `{ caseNarrative, perpetratorDetails, evidenceSummary, nextSteps }` and store as JSON in a `caseDetailsJson` column on `LegalCaseFile`.
2. Add `GET /api/reports/:reportId/legal-case/export` (legal counsel + NGO admin): generate a simple PDF or structured JSON document from `caseDetailsJson` and return it as a download (or upload to Cloudinary and return a signed URL).

**Frontend:** Add a "Draft Case Document" panel in `ReportingPage.jsx` visible only to legal counsel when the report status is `LEGAL_REVIEW` or `ESCALATED_TO_LEGAL_CASE`.

### 5.6 Staff Presence Indicators

**Backend:** In `chatSocket.js`, emit a `presence:update` event to all channel rooms when a user connects or disconnects:
```js
socket.join(`user:${userId}`);
io.to(channelIds).emit('presence:update', { userId, status: 'online' });
socket.on('disconnect', () => {
  io.to(channelIds).emit('presence:update', { userId, status: 'offline' });
});
```

**Frontend (`DirectChatPage.jsx`):** Listen for `presence:update` events and update a local `presenceMap`. Render a coloured dot (green = AVAILABLE, grey = OFFLINE) next to the counterpart's label in the channel list and in the open chat window header.

### 5.7 Survivor Chat Archive/Delete Controls

**Frontend (`DirectChatPage.jsx`):** In the channel list, add a context menu or hover actions:
- "Archive Chat" → calls `PATCH /api/chat/channels/:chatId/status` with `{ status: 'archived' }`.
- "Delete Chat" → confirmation modal → calls `PATCH` with `{ status: 'deleted' }`.
- Show archived channels only when survivor enables a toggle (the API supports `?includeArchived=true`).
This is a pure frontend change — the backend endpoint is fully implemented.

### 5.8 Fix OTP Storage Security

In `authController.js`, change OTP storage to use a hash:
```js
const crypto = require('crypto');
const hashedOtp = crypto.createHash('sha256').update(otpCode).digest('hex');
await setOtpForUser(user, hashedOtp, purpose);
// On verification:
const inputHash = crypto.createHash('sha256').update(otp).digest('hex');
if (user.otpHash !== inputHash) { ... }
```
This is a security fix and should be done before production.

### 5.9 Fix E2EE Key Exchange

Replace the current chatId-derived key with a proper ECDH flow:
1. On login, generate an ECDH key pair in the browser using `window.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' })`.
2. Upload the public key to a new backend endpoint `POST /api/profile/public-key`.
3. Before opening a channel, fetch the counterpart's public key from `GET /api/profile/:userId/public-key`.
4. Derive a shared secret: `window.crypto.subtle.deriveKey({ name: 'ECDH', public: theirKey }, myPrivateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])`.
5. The server stores only public keys; it never sees the shared secret.

### 5.10 Shared Utilities Refactor

Create `backend/src/utils/normalizeRole.js` and import it into all controllers. This removes 5 identical copies of the same function.

### 5.11 Integration Tests

For each controller, write a Jest + Supertest integration test that spins up the Express app against a test database (use a separate `DB_NAME` in `.env.test`):
- Auth: OTP request, verify, password login, lockout, reset.
- Reports: create, upload evidence, status transitions, RBAC checks.
- Chat: channel fetch, message post via socket, read receipt.
- Community: join room, post message, report message, moderation review.
- Admin: NGO dashboard, staff creation, reassignment.

### 5.12 Suggested Implementation Order

Based on user safety priority and logical dependency:

1. **Emergency intercept** — pure frontend, high safety value, 1 day.
2. **OTP hash storage** — security fix, 2 hours.
3. **USSD endpoint** — major functional requirement, 3–5 days.
4. **Notification center** (API + frontend) — 2 days.
5. **Chat archive/delete controls** — backend done, frontend only, 1 day.
6. **Staff presence indicators** — socket extension + frontend, 2 days.
7. **User banning workflow** — backend + frontend, 2–3 days.
8. **Response time analytics frontend rendering** — verify dashboard renders the existing `averageResponseMinutes` value correctly, 0.5 day.
9. **Legal case document drafting UI** — 3–4 days.
10. **ECDH key exchange** — 3 days (security enhancement, post-demo).
11. **Integration test suite** — ongoing, 1 week to cover all controllers.

---

## Appendix: File Map

```
CSProject/
├── backend/
│   ├── index.js                        # App bootstrap, socket init, DB creation, server start
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js             # Sequelize instance
│   │   │   └── cloudinary.js           # Cloudinary config + upload/signed-URL helpers
│   │   ├── controllers/
│   │   │   ├── authController.js       # OTP, password, JWT, auto-assignment
│   │   │   ├── reportController.js     # Report CRUD, evidence, status machine, analytics
│   │   │   ├── chatController.js       # Channel list, message history, archive/delete
│   │   │   ├── communityController.js  # Rooms, messages, moderation
│   │   │   ├── adminController.js      # NGO/system dashboards, maintenance, staff ops
│   │   │   ├── resourceController.js   # Resource library CRUD + Cloudinary
│   │   │   ├── profileController.js    # Per-role profile view + edit
│   │   │   └── reassignmentRequestController.js # Survivor requests + NGO review
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js        # JWT verification
│   │   │   └── authRateLimitMiddleware.js
│   │   ├── models/                     # 20+ Sequelize models
│   │   ├── routes/                     # Route files per domain
│   │   ├── services/
│   │   │   └── chatAccessService.js    # Channel membership and auto-provisioning
│   │   ├── sockets/
│   │   │   ├── chatSocket.js           # E2EE direct chat WebSocket handler
│   │   │   └── communitySocket.js      # Community room WebSocket handler
│   │   └── seeders/index.js
│   └── tests/authController.test.js
├── frontend/
│   └── src/
│       ├── App.jsx                     # SPA shell, routing, maintenance, quick exit
│       ├── components/
│       │   ├── SiteHeader.jsx
│       │   └── AdminWorkspace.jsx
│       ├── pages/                      # One file per screen
│       ├── services/                   # API call modules
│       ├── utils/cryptoUtils.js        # AES-GCM encrypt/decrypt (Web Crypto API)
│       └── data/fallbackResources.js
└── docs/
    └── pending-roadmap-items.md        # Feature completion tracker
```
