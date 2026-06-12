# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gender-Based Violence (GBV) Support Platform for Kenya. Dual-channel (Web + USSD), survivor-centred platform with six user roles: Survivor, Counsellor, Legal Counsel, NGO Admin, System Admin, and unregistered visitors.

**Stack:** React 19 (frontend) · Node.js + Express 5 + Socket.io (backend) · MySQL + Sequelize · Africa's Talking (USSD + SMS OTP) · Cloudinary (file storage)

---

## Code Style

All code in this project must include thorough inline documentation:
- JSDoc blocks on every function (purpose, `@param`, `@returns`, notable side effects)
- Inline comments on non-obvious logic, state transitions, and security-sensitive paths
- This applies to both backend (Node.js/Express) and frontend (React/JSX)

---

## Commands

### Backend (run from `backend/`)

```bash
npm run dev          # development with nodemon
npm start            # production
npm test             # all tests (Jest + Supertest, run serially)
npm run test:auth    # auth controller tests only
npm run test:watch   # watch mode
node src/seeders/index.js  # reset + reseed local DB (destructive — local only)
```

### Frontend (run from `frontend/`)

```bash
npm run dev    # Vite dev server (http://localhost:5173)
npm run build  # production build
npm run lint   # ESLint
```

### Environment setup

```bash
cp backend/.env.example backend/.env   # then fill in values
```

Required env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `JWT_SECRET`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`.  
Set `SKIP_SMS_IN_DEV=true` to bypass Africa's Talking in local dev (OTP is returned in the response body instead).  
Cloudinary vars are optional locally — upload endpoints return 503 without them, everything else works.

---

## Architecture

### Backend

**Entry point:** `backend/index.js` — bootstraps env validation, auto-creates the MySQL DB if missing, runs `sequelize.sync()`, mounts all route files and socket handlers, applies the global maintenance-mode gate.

**Model registry:** `backend/src/models/index.js` — imports all 24+ Sequelize models, wires all associations (`hasOne`, `hasMany`, `belongsTo`), and re-exports them. All controllers must import from here to get consistent association eager-loading.

**Key architectural patterns:**
- Controllers are role-scoped: every route checks `req.user.role` and calls a `normalizeRole` helper (currently duplicated across files — a known code smell).
- Auto-assignment on first survivor signup: `authController.js` creates `SurvivorProfile`, assigns the least-loaded counsellor and legal counsel by `currentWorkloadScore`, and provisions direct-chat channels — all in a single Sequelize transaction.
- Status state machine for reports: 7 states (`SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE / RESOLVED / WITHDRAWN`). Allowed transitions are role-scoped; legal case auto-creation fires on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE`.
- Maintenance mode is **in-memory** in `adminController.js` — it resets on process restart. This is a known limitation.
- OTPs are stored **plaintext** in the `otpHash` column (a known security gap; not yet hashed).

**Socket handlers:**
- `src/sockets/chatSocket.js` — JWT-authenticated. Persists opaque encrypted payloads without server-side decryption. Events: `joinChannel`, `sendEncryptedMessage` (client); `receiveMessage`, `messageError` (server).
- `src/sockets/communitySocket.js` — room join/leave, real-time message broadcast, moderation events.

**Chat channel provisioning:** `src/services/chatAccessService.js` — `ensureAutoChannelsForSurvivor` idempotently creates one channel per assigned staff member. Called on channel list fetch and during signup.

### Frontend

**Router:** `frontend/src/App.jsx` — custom SPA router using `window.history.pushState` (no React Router). Role-based route maps redirect NGO Admin and System Admin to their dashboards. No route parameters — all navigation is section-based within large page components.

**Auth guard:** Protected paths redirect to `/join` when `localStorage` token is absent. Maintenance mode is polled from `/api/system/public-status` every 15 seconds.

**Quick Exit button:** Clears auth state and navigates to Google. Auto-collapses after 3 seconds of inactivity.

**State management:** No shared state (no Context, no Zustand). All state is component-local with prop drilling. Data is re-fetched per component.

**E2EE:** `src/utils/cryptoUtils.js` — AES-GCM 256-bit via Web Crypto API. Key derived from `chatId` via PBKDF2 (demo-grade — not a full ECDH exchange; server could re-derive the key).

**API services:** `src/services/` — `admin.js`, `reports.js`, `resources.js`. Most API calls are inline `fetch`/`axios` within page components rather than service modules.

**Fallback data:** `src/data/fallbackResources.js` — static resources shown when the backend is unreachable.

---

## Incomplete Features (Roadmap)

Tracked in `docs/pending-roadmap-items.md`. Implementation guidance in `CSProject.md` (Section 5).

| Feature | Status | Notes |
|---|---|---|
| USSD live endpoint | Partial | Model + AT SMS exist; no `POST /api/ussd/callback` controller yet |
| Emergency intercept for unauthenticated reporters | Done | Intercept screen in `ReportingPage.jsx`; `/reports` removed from `protectedPaths` in `App.jsx` |
| In-app notification center | Partial | Model + fan-out writes exist; no list/read/dismiss API or UI |
| Survivor chat archive/delete controls | Partial | `PATCH /api/chat/:chatId/status` exists; frontend UI controls missing |
| Staff presence indicators | Partial | `availabilityStatus` exists; no Socket.io presence events or frontend dot |
| User banning workflow | Partial | No `BANNED` status or ban/unban endpoints |
| Legal case document drafting UI | Partial | Model exists; no authoring form or export |
| Average response-time dashboard render | Done | Computed in `adminController.js`, rendered in `NgoAdminDashboardPage.jsx` |

---

## Demo Accounts (Seeded)

| Role | Phone | Password |
|---|---|---|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |
