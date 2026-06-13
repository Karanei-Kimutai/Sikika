# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gender-Based Violence (GBV) Support Platform for Kenya. Dual-channel (Web + USSD), survivor-centred platform with six user roles: Survivor, Counsellor, Legal Counsel, NGO Admin, System Admin, and unregistered visitors.

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
- Dev shortcuts: `SKIP_SMS_IN_DEV=true` (OTP is returned in the response body instead of sent via SMS), `DB_SYNC_ALTER=false` (stable schema), `ALLOW_ADMIN_RESTART=true`

**Frontend** — create `frontend/.env`:
```
VITE_API_BASE_URL=http://localhost:5000
```

## Backend Architecture

### Bootstrap (`backend/index.js`)

Server startup sequence: load env → validate required vars → `CREATE DATABASE IF NOT EXISTS` → Sequelize authenticate → `sequelize.sync()` → mount REST routes → mount socket handlers → apply global maintenance middleware. Schema is auto-created from model definitions on every boot; no migration runner needed in development.

### Data Model (`backend/src/models/`)

- `index.js` is the single registry + association hub — all controllers/services must import from here to get consistent association eager-loading
- `userAccount.js` is the identity root; role-specific profile tables extend it (`survivorProfile`, `counsellorProfile`, `legalCounselProfile`, `ngoAdministratorProfile`, `systemAdministratorProfile`)
- UUIDs are used as PKs across most domain entities
- `SurvivorProfile` carries `assignedCounsellor` and `assignedLegalCounsel` FKs; assignment is done at signup by selecting the staff with the lowest `currentWorkloadScore`

### Request Flow

```
Route → authMiddleware (JWT verify) → controller → model (via models/index.js) → response
```

Maintenance mode middleware sits at the global level and blocks all non-admin traffic with HTTP 503 when enabled. **Known limitation:** maintenance state is held in-memory in `adminController.js` and resets on process restart.

### Auth System (`backend/src/controllers/authController.js`)

- Dual auth paths: OTP (via Africa's Talking SMS) and password; both enforce lockout counters persisted on `UserAccount`
- JWT payload carries both `id` and `userId` for compatibility
- On first survivor signup: creates `SurvivorProfile`, assigns least-loaded counsellor and legal counsel by `currentWorkloadScore`, and provisions direct-chat channels — all in a single Sequelize transaction
- `status=password_reset_required` triggers first-login forced reset; backend returns `authStage=PASSWORD_RESET_REQUIRED` and frontend must call `POST /api/auth/set-password` before normal navigation
- **Known security gap:** OTPs are stored plaintext in the `otpHash` column (not yet hashed)
- Controllers use a `normalizeRole` helper for role-checking — currently duplicated across controller files (known code smell)

### Report Status State Machine

7 states with role-scoped allowed transitions:

```
SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE
                                                                                → RESOLVED
                                                                                → WITHDRAWN
```

Legal case auto-creation fires on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE` transitions.

### Sockets (`backend/src/sockets/`)

- `chatSocket.js` — JWT-authenticated; persists opaque encrypted payloads without server-side decryption. Events: `joinChannel`, `sendEncryptedMessage` (client); `receiveMessage`, `messageError` (server)
- `communitySocket.js` — room join/leave, real-time message broadcast, moderation events (`community:new-message`, `community:message-updated`, `community:message-deleted`)

### Chat Channel Provisioning (`backend/src/services/chatAccessService.js`)

`ensureAutoChannelsForSurvivor` idempotently creates one channel per assigned staff member (`findOrCreate`). Called on channel list fetch and during signup — no manual channel creation needed.

### USSD (`backend/src/controllers/ussdController.js`)

Live endpoint: `POST /api/ussd/callback`. NGO admin USSD management endpoints and dashboard section are included.

## Frontend Architecture

### Routing & Auth Shell (`frontend/src/App.jsx`)

Custom SPA router using `window.history.pushState` — **no React Router**. Navigation is section-based within large page components, not URL-parameter-based. Role-based route maps redirect NGO Admin and System Admin to their dashboards. Maintenance mode polled from `/api/system/public-status` every 15 seconds.

Session: `authToken` + `userId` persisted in `localStorage`. Protected routes redirect to `/join` when session is absent.

### State Management

No shared state — no Context API, no Zustand. All state is component-local with prop drilling. Data is re-fetched per component mount.

### Feature Pages (`frontend/src/pages/`)

Each page owns its screen-level state (loading, errors, selected entities):

| Page | Feature |
|---|---|
| `AuthPage.jsx` | OTP + password auth, signup, forgot password, forced reset |
| `DirectChatPage.jsx` | E2EE chat, channel switching, privacy mask; Archive/Restore/Delete action menu per channel |
| `CommunityPage.jsx` | Rooms, join gate, moderation actions |
| `LibraryPage.jsx` | Public resource browsing + staff write actions |
| `ReportingPage.jsx` | Incident report submission + evidence upload; emergency intercept screen for unauthenticated reporters (`/reports` is not a protected path) |
| `NgoAdminDashboardPage.jsx` | NGO KPIs, case triage, staff management, moderation queue, USSD callback queue |
| `SystemAdminDashboardPage.jsx` | Infrastructure, logs, maintenance control, staff lifecycle |

### Service Layer (`frontend/src/services/`)

- `admin.js` — dashboard, search, maintenance, runtime actions, staff lifecycle, moderation reviews
- `resources.js` — CRUD + access tracking for support resources
- `reports.js` — report submission and status

Note: some API calls are inline `fetch`/`axios` within page components rather than service modules.

### E2EE Chat (`frontend/src/utils/cryptoUtils.js`)

AES-GCM 256-bit via Web Crypto API. Key derived from `chatId` via PBKDF2 (demo-grade — not a full ECDH exchange; the server could re-derive the key from the chatId). Server stores and relays only ciphertext; plaintext never leaves the client.

### Quick Exit Button

Clears auth state and navigates to Google. Auto-collapses after 3 seconds of inactivity.

### Fallback Data (`frontend/src/data/fallbackResources.js`)

Static resource list shown in the Library when the backend is unreachable.

## Key Cross-Cutting Behaviors

- **Cloudinary**: evidence files and support resources both use Cloudinary. Without env vars, upload endpoints return 503 but read endpoints still work.
- **Community moderation "block user"**: maps to `accountStatus = SUSPENDED` on `UserAccount` — not a separate block record. Suspended users lose all authenticated access until reactivated.
- **Survivor identity in community**: survivors appear by nickname only in room timelines.
- **Resource access tracking**: `POST /api/resources/:id/track-access` is best-effort; frontend fires and ignores failures so it never blocks resource opens.

## Incomplete Features

Tracked in `docs/pending-roadmap-items.md`.

| Feature | Status | Notes |
|---|---|---|
| In-app notification center | Partial | Model + fan-out writes exist; no list/read/dismiss API or UI |
| Survivor chat archive/delete controls | Done | `PATCH /api/chat/:chatId/status` + Archive/Restore/Delete action menu in `DirectChatPage.jsx` |
| Staff presence indicators | Partial | `availabilityStatus` field exists; no Socket.io presence events or frontend indicator |
| User banning workflow | Partial | No `BANNED` status or ban/unban endpoints |
| Legal case document drafting UI | Partial | Model exists; no authoring form or export |
| Average response-time dashboard render | Done | Computed in `adminController.js`, rendered in `NgoAdminDashboardPage.jsx` |

## Demo Credentials (seeded data)

| Role | Phone | Password |
|---|---|---|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |
