# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gender-Based Violence (GBV) Support Platform for Kenya. Dual-channel (Web + USSD), survivor-centred platform with six user roles: Survivor, Counsellor, Legal Counsel, Moderator, NGO Admin, and unregistered visitors. NGO Admin is the only admin role — System Admin was removed; the one capability it owned that's still needed (maintenance mode) is folded into the NGO Admin dashboard.

**Stack:** React 19 (frontend) · Node.js + Express 5 + Socket.io (backend) · MySQL + Sequelize · Africa's Talking (USSD + SMS OTP) · Cloudinary (file storage)

## Code Style

All code in this project must include thorough inline documentation:
- JSDoc blocks on every function (purpose, `@param`, `@returns`, notable side effects)
- Inline comments on non-obvious logic, state transitions, and security-sensitive paths
- Applies to both backend (Node.js/Express) and frontend (React/JSX)

## Development Commands

### Backend (`cd backend`)

```bash
npm run dev          # nodemon hot-reload server on port 5000
npm start            # production start
npm test             # Jest (runs serially with --runInBand)
npm run test:auth    # single file: tests/authController.test.js
npm run test:watch   # Jest watch mode
node src/seeders/index.js  # DESTRUCTIVE: drops + recreates all tables then seeds demo data
```

### Frontend (`cd frontend`)

```bash
npm run dev      # Vite dev server on port 5173
npm run build    # production build to dist/
npm run preview  # serve dist/
npm run lint     # ESLint
```

## Environment Setup

**Backend** — copy `backend/.env.example` to `backend/.env`:

- Required: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `JWT_SECRET`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`
- Optional but needed for uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Dev shortcuts: `SKIP_SMS_IN_DEV=true` (OTP is returned in the response body instead of sent via SMS), `DB_SYNC_ALTER=false` (stable schema), `ENABLE_SCHEMA_COMPAT=true` (boot-time ENUM reconciliation via `schemaCompatibility.js`; set to `false` for emergency rollback without a code revert)

**Frontend** — create `frontend/.env`:
```
VITE_API_BASE_URL=http://localhost:5000
```

## Backend Architecture

### Bootstrap (`backend/index.js`)

Server startup sequence: load env → validate required vars → `CREATE DATABASE IF NOT EXISTS` → Sequelize authenticate → `sequelize.sync()` → **`ensureSchemaCompatibility(sequelize)`** → mount REST routes → mount socket handlers → apply global maintenance middleware. Schema is auto-created from model definitions on every boot; no migration runner needed in development.

`ensureSchemaCompatibility` (`backend/src/utils/schemaCompatibility.js`) runs idempotent DDL guards on every boot: data-backfill UPDATE first (prevents ENUM truncation errors), then MODIFY COLUMN to add new ENUM members. Gated by `ENABLE_SCHEMA_COMPAT` env flag (default `true`). Emits one structured log line per boot summarising what was checked / applied / skipped. Manual `ALTER TABLE` commands for schema changes are **deprecated** — add reconciliation steps to this file instead.

### Data Model (`backend/src/models/`)

- `index.js` is the single registry + association hub — all controllers/services must import from here to get consistent association eager-loading
- `userAccount.js` is the identity root; role-specific profile tables extend it (`survivorProfile`, `counsellorProfile`, `legalCounselProfile`, `ngoAdministratorProfile`, `moderatorProfile`)
- UUIDs are used as `VARCHAR(36)` PKs across most domain entities (32 hex chars + 4 hyphens — intentional, doubles as an anti-enumeration measure)
- `isOtpVerified` (and other flag-like columns) are declared as `DataTypes.BOOLEAN` in Sequelize; MySQL has no native boolean type and always physically stores `BOOLEAN` as `TINYINT(1)` regardless of how it was declared — that's a MySQL rendering detail, not a schema mistake
- `SurvivorProfile` carries `assignedCounsellor` and `assignedLegalCounsel` FKs; assignment is done at signup by selecting the staff with the lowest `currentWorkloadScore`

### Request Flow

```
Route → authMiddleware (JWT verify) → controller → model (via models/index.js) → response
```

Maintenance mode middleware sits at the global level and blocks all non-admin traffic with HTTP 503 when enabled. Maintenance state is persisted to the `SystemSetting` table (key `'maintenance'`, JSON value) and loaded at boot via `loadMaintenanceStateFromDb()`, so it survives process restarts. An in-process cache (`_maintenanceCache`) keeps the guard fast (no DB round-trip per request).

### Auth System (`backend/src/controllers/authController.js`)

- **Signup (3 steps, OTP-first):** `POST /api/auth/request-otp` (phone → SMS OTP, purpose `SIGNUP_OTP`) → `POST /api/auth/verify-otp` (OTP only, no password yet; on success issues a short-lived **signup ticket**, purpose `SIGNUP_TICKET`, reusing the same bcrypt-hashed OTP storage fields; returns `authStage=DETAILS_REQUIRED`) → `POST /api/auth/complete-signup` (`{ phoneNumber, signupTicket, password, profileDetails }`; validates the ticket, sets the password, creates `SurvivorProfile`, assigns least-loaded counsellor and legal counsel by `currentWorkloadScore`, provisions direct-chat channels, and issues the JWT — all in a single Sequelize transaction via `ensureSurvivorStaffAutoAssignment`).
- **Signin (password + mandatory 2FA):** `POST /api/auth/login-password` validates the password but does **not** issue a JWT — it sends a `SIGNIN_2FA` OTP and returns `authStage=OTP_2FA_REQUIRED`. `POST /api/auth/verify-2fa` validates that OTP and issues the JWT. OTP is no longer a standalone alternative login method — it's enforced as the second factor after every password match. Exception: accounts with `status=password_reset_required` get the JWT immediately from `login-password` (they must set a real password before normal navigation anyway, so 2FA is deferred to their next login).
- Both lockout counters (`authFailedAttempts`/`authLockUntil` for password, `otpAttemptCount` for OTP) are persisted on `UserAccount` and shared across all OTP-purpose flows.
- JWT payload carries both `id` and `userId` for compatibility
- `status=password_reset_required` triggers first-login forced reset; backend returns `authStage=PASSWORD_RESET_REQUIRED` and frontend must call `POST /api/auth/set-password` before normal navigation
- OTPs (and the signup ticket) are bcrypt-hashed (10 rounds) before storage in `otpHash`; all verify paths use `bcrypt.compare`. Dev mode returns the plaintext code in the response body via `developmentOtp` for local testing only.
- `normalizeRole` and `BANNABLE_ROLES` are defined once in `backend/src/utils/roles.js` and imported by all controllers and services that need them.

### Report Status State Machine

7 states with role-scoped allowed transitions:

```
SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE
                                                                                → RESOLVED
                                                                                → WITHDRAWN
```

Legal case auto-creation fires on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE` transitions.

### Sockets (`backend/src/sockets/`)

- `chatSocket.js` — JWT-authenticated; persists opaque encrypted payloads without server-side decryption. Events: `joinChannel`, `sendEncryptedMessage` (client); `receiveMessage`, `messageError` (server). **Presence integration:** on connect, joins `user:<userId>` personal room and calls `presenceRegistry.markOnline`; broadcasts `presence:update` to affected survivors; runs delivery catch-up (`deliveredAt` bulk-set for messages received offline, `message:delivered` emitted). On `sendEncryptedMessage`, sets `deliveredAt` immediately when recipient is online. On disconnect, `presenceRegistry.markOffline` then re-broadcasts OFFLINE if last socket.
- `communitySocket.js` — room join/leave, real-time message broadcast, moderation events (`community:new-message`, `community:message-updated`, `community:message-deleted`)
- **`presenceRegistry.js`** (`backend/src/services/`) — shared in-memory singleton tracking live socket connections. `getEffectivePresence(userId, manualStatus)` unifies real connectivity with the manual BUSY override.

### Chat Channel Provisioning (`backend/src/services/chatAccessService.js`)

`ensureAutoChannelsForSurvivor` idempotently creates one channel per assigned staff member (`findOrCreate`). Called on channel list fetch and during signup — no manual channel creation needed.

### USSD (`backend/src/controllers/ussdController.js`)

Live endpoint: `POST /api/ussd/callback`. NGO admin USSD management endpoints and dashboard section are included. Callback requests are auto-routed: `pickLeastLoadedCounsellor` assigns the least-loaded available counsellor (`ussdCallbackRequest.assignedCounsellorId`) at creation time, so NGO Admin sees "Assigned To" in the queue instead of manually triaging every request — admin can still reassign.

### Moderator role (`backend/src/controllers/communityController.js`)

Delegated subset of NGO Admin responsibilities: Moderation Desk (reports queue, message removal, warnings, bans/unbans) + Community Chat oversight. `MODERATOR` is a `userRole` ENUM member with its own `moderatorProfile` table (`currentWorkloadScore` — incremented per moderation action for capacity visibility; the report queue itself stays a shared pull queue, not per-item assigned). `getModerationReports`/`reviewReport`/`deleteMessage` in `communityController.js` allow both `NGO_ADMIN` and `MODERATOR`. Frontend: `MODERATOR` logins route to a narrow nav (Moderation Desk + Community Chat only) via `moderatorRoutes` in `App.jsx`, reusing `ModerationDashboardPage.jsx` and `CommunityPage.jsx`. Onboarded via the same NGO staff-onboarding form (`createStaffAccount`) as Counsellor/Legal Counsel.

### Auto-suggested staff reassignment (`backend/src/controllers/adminController.js`)

`getLeastLoadedStaff(ProfileModel, idField, excludeId)` is the shared least-loaded-staff selector, used by both `cascadeReassignOnStaffBan` (auto-reassignment when a counsellor/legal counsel is banned) and `GET /api/admin/ngo/reassignments/suggestions?survivorId=` (recommends a replacement counsellor/legal counsel for the Team Capacity manual reassignment form — shown as a "Recommended" badge the admin can apply or ignore). It inner-joins `UserAccount` and requires `accountStatus = 'ACTIVE'` — suspending or banning a staff member only flips `UserAccount.accountStatus`, leaving their profile's `availabilityStatus` untouched, so without this join a suspended/banned staff member could still be recommended or auto-assigned. The same active-account join is applied to `pickLeastLoadedStaff` in `authController.js` (initial signup auto-assignment).

## Frontend Architecture

### Routing & Auth Shell (`frontend/src/App.jsx`)

Custom SPA router using `window.history.pushState` — **no React Router**. Navigation is section-based within large page components, not URL-parameter-based. Role-based route maps redirect NGO Admin to its dashboard and Moderator to a narrow Moderation Desk + Community Chat nav (`moderatorRoutes`). Maintenance mode polled from `/api/system/public-status` every 15 seconds; only `NGO_ADMIN` sessions bypass the maintenance screen (the only admin role since System Admin's removal).

Session: `authToken` + `userId` persisted in `sessionStorage` (tab-scoped; cleared on tab close). Protected routes redirect to `/join` when session is absent.

### State Management

No shared state — no Context API, no Zustand. All state is component-local with prop drilling. Data is re-fetched per component mount.

### Feature Pages (`frontend/src/pages/`)

Each page owns its screen-level state (loading, errors, selected entities):

| Page | Feature |
|---|---|
| `AuthPage.jsx` | 3-step OTP-first signup (phone → OTP → password/profile details) via `SignUpFlow.jsx`; password + mandatory-2FA signin via `SignInFlow.jsx`; forgot password, forced reset |
| `DirectChatPage.jsx` | E2EE chat, channel switching, privacy mask; Archive/Restore/Delete action menu per channel |
| `CommunityPage.jsx` | Rooms, join gate, moderation actions (`canModerate` covers NGO_ADMIN + MODERATOR) |
| `LibraryPage.jsx` | Public resource browsing + staff write actions |
| `ReportingPage.jsx` | Incident report submission + evidence upload; emergency intercept screen for unauthenticated reporters (`/reports` is not a protected path) |
| `NgoAdminDashboardPage.jsx` | NGO KPIs, case triage, staff management, USSD callback queue (with auto-assigned counsellor), maintenance-mode toggle; section components under `pages/ngo-admin/`; Moderation Desk has internal tabs (Reports Queue / Banned Users) managed by `ModerationDeskSection.jsx`; chart uses gradient bars + smooth bezier trend in `CommandCenterSection.jsx` |
| `ModerationDashboardPage.jsx` | Moderator's Moderation Desk view (also reused as the NGO Admin's `/moderation` route) |

### Service Layer (`frontend/src/services/`)

- `admin.js` — NGO dashboard, search, maintenance mode, staff lifecycle, moderation reviews, reassignment suggestions (System Admin's infra/logs/runtime-action calls were removed along with that role)
- `resources.js` — CRUD + access tracking for support resources
- `reports.js` — report submission and status

Note: some API calls are inline `fetch`/`axios` within page components rather than service modules.

### E2EE Chat (`frontend/src/utils/cryptoUtils.js`, `keyStorage.js`, `services/chatKeys.js`)

Real ECDH (P-256) key agreement + AES-GCM 256-bit via Web Crypto API. Each user's private key is generated non-extractable and persisted only in this browser's IndexedDB (`keyStorage.js`); only the public key (`userAccount.ecdhPublicKey`, JWK string) is sent to the server via `GET/PUT /api/chat/public-key`. `App.jsx` registers/refreshes the local keypair's public half on every authenticated app load; `DirectChatPage.jsx` fetches the channel counterpart's public key (via the `counterpartUserId` field on `getChannels`'s response) and derives the shared AES-GCM key client-side. Server stores and relays only ciphertext and public keys; plaintext and private keys never leave the client. No safety-number verification or multi-device support — see `docs/e2ee.md` for the full design and threat model.

If the counterpart hasn't logged in yet (no public key registered), the composer stays usable instead of blocking: messages queue client-side in `localStorage` (`frontend/src/utils/pendingMessageQueue.js`, per-`chatId`) and auto-send once the counterpart's key becomes available, signalled by the `chatKey:available` Socket.io event (`backend/src/controllers/chatController.js` `setPublicKey`, fanned out to channel counterparts via `chatAccessService.getChannelsForParticipant`) with a 30s polling fallback. See `docs/e2ee.md`'s "Pending-message queue" section.

### Quick Exit Button

Clears auth state and navigates to Google. Auto-collapses after 3 seconds of inactivity.

### Fallback Data (`frontend/src/data/fallbackResources.js`)

Static resource list shown in the Library when the backend is unreachable. Full module documentation in `docs/resource-management.md`.

## Key Cross-Cutting Behaviors

- **Cloudinary**: evidence files, support resources, and legal case PDFs all use Cloudinary with `type: authenticated` (private). All three are delivered via backend streaming proxies — Cloudinary URLs and signed URLs **never reach the browser**. Support resources: `GET /api/resources/:resourceId/file` (unauthenticated, library is public). Report evidence: `GET /api/reports/:reportId/evidence/:evidenceId/file` (JWT required; frontend fetches as blob and creates an object URL). Legal-case PDFs: `GET /api/legal-cases/:legalCaseId/document` (JWT + LEGAL_COUNSEL only; same blob pattern). The shared `fetchPrivateAssetStream({ publicId, resourceType })` helper in `backend/src/config/cloudinary.js` handles the `private_download_url` fetch and redirect follow for all three. Without env vars, upload and streaming endpoints return 503 but list endpoints still work (fallback data shown in the Library).
- **Community moderation enforcement**: the "block_user"/"suspend_user" path has been removed. Moderation now uses `action: "ban_user"` in `reviewReport` (`communityController.js`), which sets `accountStatus = BANNED` with full metadata (reason, expiry, bannedByUserId) and resolves the report atomically. `SUSPENDED` is reserved for the operational Active/Inactive staff toggle in the Team Capacity section of the NGO dashboard.
- **`SUSPENDED` vs `BANNED`**: `SUSPENDED` = reversible staff operational pause (no metadata); `BANNED` = moderation/safety enforcement (reason + optional expiry + dual audit trail). Both block all authenticated access immediately via `authMiddleware` DB lookup.
- **Survivor identity in community**: survivors appear by nickname only in room timelines.
- **Resource access tracking**: `POST /api/resources/:id/track-access` is best-effort; frontend fires and ignores failures so it never blocks resource opens.
- **Single fixed theme**: CSS custom properties in `frontend/src/App.css` `:root` define the only theme. There is no dark mode — an earlier OS-driven `@media (prefers-color-scheme: dark)` override was removed so the UI looks identical regardless of the visitor's browser/OS preference; `index.html` pins `<meta name="color-scheme" content="light">` so native form controls/scrollbars don't switch either. Use existing tokens (`--surface`, `--community-*`, `--legal-*`, `--status-*`, `--chart-*`, `--workspace-*`) rather than hardcoded hex for consistency, not for dark-mode support.

## Incomplete Features

Tracked in `docs/pending-roadmap-items.md`.

| Feature | Status | Notes |
|---|---|---|
| In-app notification center | Done | `GET/PATCH /api/notifications/*` endpoints; `NotificationBell` in `SiteHeader` with real-time socket push (`notification:new` via `user:<userId>` room) + 30s-poll fallback; `notificationDismissedStatus` column keeps dismiss state separate from read state. `notificationService.js` is the single write path (used by reportController, chatSocket, communityController). |
| Survivor chat archive/delete controls + Trash view | Done | `PATCH /api/chat/:chatId/status` (transitions: `active↔archived`, `active/archived→deleted`, `deleted→active`); Archive/Restore/Delete action menu in `DirectChatPage.jsx`; separate Trash toggle (`includeDeleted=true`) shows only deleted channels so survivors can restore contact; `deleted→active` restore is survivor-owner only; staff never see deleted channels; tested in `chatTrashRestore.test.js` (backend, 16 tests) and `chat-trash-restore.spec.js` (E2E, 5 tests) |
| Staff presence indicators | Done | `presenceRegistry.js` in-memory singleton (Map of userId→Set of socketIds); `chatSocket.js` joins per-user rooms and broadcasts `presence:update` on connect/disconnect; delivery catch-up marks pending `deliveredAt` on reconnect; `markChannelRead` sets `seenAt` and emits `message:seen`; `DirectChatPage.jsx` shows coloured presence dot + Sent/Delivered/Seen ticks; effective presence = real connectivity layered over manual BUSY status |
| User banning workflow | Done | `BANNED` added to `accountStatus` ENUM + ban metadata columns; `PATCH /api/admin/ngo/users/:id/ban` and `.../unban`; `authMiddleware` does DB lookup on every authenticated request for immediate mid-session enforcement; `liftExpiredBan` auto-restores temporary bans at next auth check; `chatSocket.js` checks accountStatus on connect + per-send; NGO dashboard ban modal + Staff Directory status badges; Banned Users registry is now a **tab inside Moderation Desk** (`ModerationDeskSection.jsx` → `BannedUsersSection.jsx`) — no longer a standalone nav section; banning from Moderation Desk resolves the underlying report atomically; dual audit trail (ModerationActionLog + AuditLog); ban immediately evicts active sockets via `disconnectSockets(true)`; banning a COUNSELLOR/LEGAL_COUNSEL triggers `cascadeReassignOnStaffBan` (auto-reassigns their survivors) — fired from **both** the admin `PATCH /api/admin/ngo/users/:id/ban` endpoint and the community moderation `reviewReport ban_user` action (the latter exports `cascadeReassignOnStaffBan` from `adminController.js` and calls it post-commit), so a counsellor/legal counsel banned for harmful community content also has their caseload reassigned, not just one banned via the admin panel. Community `reviewReport ban_user` enforces the same `BANNABLE_ROLES` allow-list + self-ban rejection as the admin endpoint. `SUSPENDED` reframed as Active/Inactive staff toggle. Both the signup auto-assignment (`pickLeastLoadedStaff`) and the cascade/suggestion selector (`getLeastLoadedStaff`) require `UserAccount.accountStatus = 'ACTIVE'` so a suspended or banned staff member is never recommended or auto-assigned a new survivor. |
| Legal case document drafting UI | Done | Structured authoring fields added to `legalCaseFile` model; `legalDocumentService.js` renders pdfkit PDF in memory; PDF uploaded privately to Cloudinary; `PATCH/POST/GET /api/legal-cases/:id/*` endpoints; `ReportingPage.jsx` full drafting panel (4 fields, Save Draft, Generate Document, Open Document, status advance) for LEGAL_COUNSEL role; `frontend/src/services/legalCases.js` service layer |
| Average response-time dashboard render | Done | Computed in `adminController.js`, rendered in `NgoAdminDashboardPage.jsx` |

## Demo Credentials (seeded data)

| Role | Phone | Password |
|---|---|---|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |
| Legal Counsel | +254700000030 | LegalCounsel@2026! |
| NGO Admin | +254700000010 | NgoAdmin@2026! |
| Moderator | +254700000001 | Moderator@2026! |
