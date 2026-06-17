# Backend

Express + Sequelize (MySQL) backend for the GBV Support Platform. Handles authentication, incident reporting, direct chat, community rooms, USSD, moderation, notifications, legal case management, and websocket relay.

- OTP and password authentication with lockout, ban enforcement, and forced-reset flows
- Role-aware operations for Survivors, Counsellors, Legal Counsel, NGO Admins, and System Admins
- USSD channel via Africa's Talking for low-tech access (no internet required)
- E2EE direct chat relay, community rooms, and real-time presence via Socket.io
- Incident reporting with Cloudinary-backed evidence uploads
- Legal case file drafting and PDF generation
- Maintenance mode, runtime actions, and full audit logging

For deep-dives see:
- [`docs/authentication.md`](../docs/authentication.md) — auth flows, OTP lifecycle, JWT, security rules
- [`docs/server-bootup.md`](../docs/server-bootup.md) — full server startup sequence
- [`docs/ussd.md`](../docs/ussd.md) — USSD menu tree, AT integration, local dev setup

---

## Core Stack

- Node.js 18+
- Express 5
- Sequelize + MySQL
- Socket.io
- bcrypt
- JWT
- Africa's Talking (USSD + SMS OTP)
- Multer (multipart evidence uploads)
- Cloudinary (evidence storage, support resource storage, legal case PDFs)
- pdfkit (in-memory legal document generation)

---

## Local Setup

```bash
npm install
```

Copy the env template and fill in your values:

```bash
cp .env.example .env
```

Run in development (hot-reload via nodemon):

```bash
npm run dev
```

Run in production mode:

```bash
npm start
```

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port |
| `DB_NAME` | Database name (created automatically on boot if missing) |
| `DB_USER` | MySQL user |
| `JWT_SECRET` | Secret used to sign and verify all JWTs |
| `AFRICASTALKING_API_KEY` | Africa's Talking API key |
| `AFRICASTALKING_USERNAME` | AT account username — set to `"sandbox"` for sandbox mode |

### Recommended

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Port the HTTP server listens on |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Browser origin allowed by CORS and Socket.io |
| `NODE_ENV` | — | `"development"` or `"production"`. Production enforces AT sandbox and SMS bypass rules. |
| `SKIP_SMS_IN_DEV` | `false` | Set `"true"` (non-production only) to skip SMS and return OTP in response body |
| `DB_PASSWORD` | — | MySQL password (omit only if your local MySQL user has no password) |
| `DB_SYNC_ALTER` | `false` | Set `"true"` once to run `sequelize.sync({ alter: true })` on this boot |
| `ENABLE_SCHEMA_COMPAT` | `true` | Set `"false"` to skip boot-time schema reconciliation (emergency rollback only) |

### Africa's Talking (optional)

| Variable | Description |
|----------|-------------|
| `AFRICASTALKING_SENDER_ID` | Approved SMS sender ID shown instead of a shared shortcode. Leave blank to use the default shortcode. |

### Auth security knobs (optional)

All default to safe values. Can be tightened without a code change.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_OTP_TTL_MS` | `600000` | OTP validity window in milliseconds (10 min) |
| `AUTH_OTP_MAX_ATTEMPTS` | `5` | Max OTP verification attempts before lockout |
| `AUTH_LOGIN_MAX_ATTEMPTS` | `5` | Max password failures before lockout |
| `AUTH_LOCKOUT_MS` | `900000` | Lockout duration in milliseconds (15 min) |

### Cloudinary (required for file uploads)

| Variable | Description |
|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | API secret — used to sign URLs and authenticate server-side requests |

Without Cloudinary config, evidence upload endpoints, support-resource write endpoints, and legal case PDF generation return 503 — read endpoints still work.

Full documentation: [`docs/cloudinary.md`](../docs/cloudinary.md)

---

## Startup Sequence

Main bootstrap file: `backend/index.js`. Full documentation: [`docs/server-bootup.md`](../docs/server-bootup.md).

1. **Proxy cleanup** — removes dead proxy env vars that break the AT SDK in WSL/IDE environments
2. **Express + Socket.io init** — wraps Express in an HTTP server so REST and WebSockets share port 5000; mounts `chatSocket` and `communitySocket`
3. **Middleware + routes** — CORS, JSON parsing, global `maintenanceGuard`, all route modules
4. **`validateEnv()`** — fail-fast on missing required vars; enforces production safety rules (no sandbox username, no dev SMS bypass)
5. **`ensureDatabaseExists()`** — `CREATE DATABASE IF NOT EXISTS` so developers never need to create the DB manually
6. **`sequelize.authenticate()`** — verifies DB connection
7. **`sequelize.sync()`** — creates missing tables from model definitions; alter mode optional via `DB_SYNC_ALTER`
8. **`ensureSchemaCompatibility()`** — idempotent DDL guards for schema drift (ENUM evolution, missing columns); gated by `ENABLE_SCHEMA_COMPAT`
9. **`loadMaintenanceStateFromDb()`** — restores durable maintenance mode state from the `SystemSetting` table
10. **`server.listen()`** — begins accepting HTTP and WebSocket connections

Any failure in steps 4–9 exits the process with a descriptive error before the port is opened.

---

## Data Model Architecture

### Model definitions

Every table is a Sequelize model in `backend/src/models/*.js`. Models define columns, types, UUIDs as PKs (across most domain entities), nullability, and defaults.

Key models:

- `userAccount.js` — identity root for auth and role-based access
- `survivorProfile.js`, `counsellorProfile.js`, `legalCounselProfile.js` — role-specific domain extensions
- `incidentReport.js`, `evidenceFile.js`, `legalCaseFile.js` — reporting and legal escalation
- `directChatChannel.js`, `directChatMessage.js` — survivor-to-staff private chat
- `ussdCallbackRequest.js` — USSD callback queue entries

### Model registry

`backend/src/models/index.js` is the single registry and association hub. All controllers and services import models from here to get consistent eager-loading.

Association highlights:

- `UserAccount` has one role profile (survivor / counsellor / legal / NGO admin / system admin)
- `SurvivorProfile` belongs to assigned counsellor and assigned legal counsel
- `IncidentReport` belongs to a survivor and has many evidence files
- `DirectChatChannel` belongs to a survivor and a staff counterpart
- `CommunityRoom` has memberships, messages, and moderation references

### Schema changes

Do **not** run manual `ALTER TABLE` commands. Add reconciliation steps to `backend/src/utils/schemaCompatibility.js` instead — it runs on every boot, is idempotent, and emits a structured one-line log showing what was checked/applied/skipped.

### Seeding

```bash
node src/seeders/index.js
```

The seeder runs `sync({ force: true })` — **drops and recreates all tables** before inserting demo data. A hard guard aborts with `process.exit(1)` when `NODE_ENV === 'production'`. Use only in local/disposable environments.

Seeds a full working graph: admins, counsellors, legal counsel, survivors, assignment history, reports, evidence, legal cases, direct chat, community data, notifications, resources, moderation, and audit rows.

After seeding, an integrity check asserts every survivor has exactly one counsellor channel and one legal-counsel channel — seeding fails loudly on any mismatch.

---

## API Index

### Health and Status

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/hello` | None | Smoke test |
| GET | `/api/health` | None | Express health check |
| GET | `/api/health/db` | None | Database connectivity check |
| GET | `/api/system/public-status` | None | Maintenance mode state (polled by frontend every 15s) |

### Authentication

Full documentation: [`docs/authentication.md`](../docs/authentication.md)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/request-otp` | None | Request signup or signin OTP |
| POST | `/api/auth/verify-otp` | None | Verify OTP; completes signup or issues signin token |
| POST | `/api/auth/login-password` | None | Password-based signin |
| POST | `/api/auth/forgot-password/request` | None | Request password-reset OTP |
| POST | `/api/auth/forgot-password/reset` | None | Submit reset OTP and new password |
| POST | `/api/auth/set-password` | JWT | Set or change password for the authenticated user |
| GET | `/api/auth/session` | JWT | Returns decoded session payload |

Key behaviours:

- Phone numbers are normalized to E.164 before lookup
- OTPs are bcrypt-hashed before storage; purpose-bound to prevent cross-flow replay
- Both OTP and password paths share the same 5-attempt lockout (15 min)
- BANNED accounts are rejected with ban reason and expiry; expired temporary bans are auto-lifted on every auth check
- Staff provisioned by NGO admin arrive with `status=password_reset_required`; first login returns `authStage=PASSWORD_RESET_REQUIRED` and the frontend must call `/set-password` before normal navigation

### USSD

Full documentation: [`docs/ussd.md`](../docs/ussd.md)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/ussd/callback` | None | Africa's Talking USSD webhook — handles all session interactions |
| GET | `/api/ussd/callback-requests` | JWT (NGO_ADMIN) | List all USSD callback requests, newest first |
| PATCH | `/api/ussd/callback-requests/:requestId` | JWT (NGO_ADMIN) | Update callback request status (COMPLETED / CANCELLED) |

Menu tree: Welcome → 1) Request callback (with confirmation step) → 2) Emergency contacts. See `docs/ussd.md` for full tree and local dev setup with ngrok.

### Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/notifications` | JWT | List notifications for the authenticated user |
| PATCH | `/api/notifications/:id/read` | JWT | Mark a notification as read |
| PATCH | `/api/notifications/:id/dismiss` | JWT | Dismiss a notification |

Real-time push via `notification:new` socket event on the user's personal `user:<userId>` room; 30-second poll fallback on the frontend.

### Resources

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/resources` | None | List all resources (public) |
| POST | `/api/resources/:id/track-access` | None | Fire-and-forget access tracking |
| POST | `/api/resources` | JWT (staff) | Upload a new resource |
| PATCH | `/api/resources/:id` | JWT (staff) | Update resource metadata or replace file |
| DELETE | `/api/resources/:id` | JWT (staff) | Delete a resource |

Upload constraints: multipart field `file`, max 20MB, allowed types: PDF, DOC, DOCX, TXT, JPG, PNG, WEBP, MP3, WAV, MP4. Write access restricted to COUNSELLOR, LEGAL_COUNSEL, NGO_ADMIN.

Resource files are stored in Cloudinary as `type: authenticated` and are never exposed as direct Cloudinary URLs. `GET /api/resources/:id/file` proxies the file through the backend using API credentials and streams it to the client — this bypasses account-level Cloudinary delivery restrictions that blocked direct URL access for raw files.

### Reports

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/reports` | None | Submit an incident report (unauthenticated allowed) |
| GET | `/api/reports` | JWT | List reports for the authenticated user |
| GET | `/api/reports/:reportId` | JWT | Get a single report |
| PATCH | `/api/reports/:reportId` | JWT | Update report fields |
| PATCH | `/api/reports/:reportId/status` | JWT | Advance report through the status state machine |
| PATCH | `/api/reports/:reportId/withdraw` | JWT | Survivor withdraws their report |
| DELETE | `/api/reports/:reportId` | JWT | Delete a report |
| POST | `/api/reports/:reportId/evidence` | JWT | Upload evidence file |
| GET | `/api/reports/:reportId/evidence/:evidenceId/file` | JWT | Stream private evidence bytes via backend proxy |
| GET | `/api/reports/analytics/summary` | JWT | Report analytics summary |

Report status state machine: `SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE / RESOLVED / WITHDRAWN`. Legal case auto-creation fires on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE` transitions.

### Legal Cases

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/legal-cases/:id` | JWT | Get a legal case |
| PATCH | `/api/legal-cases/:id` | JWT (LEGAL_COUNSEL) | Update case fields / save draft |
| POST | `/api/legal-cases/:id/document` | JWT (LEGAL_COUNSEL) | Generate PDF and upload to Cloudinary |
| GET | `/api/legal-cases/:id/document` | JWT | Stream case PDF bytes via backend proxy |

### Chat

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/chat/channels` | JWT | List direct chat channels for the authenticated user |
| GET | `/api/chat/:chatId/messages` | JWT | Get messages for a channel |
| PATCH | `/api/chat/:chatId/read` | JWT | Mark channel as read (sets `seenAt`) |
| PATCH | `/api/chat/:chatId/status` | JWT | Archive, restore, or delete a channel (`active ↔ archived`, `active/archived → deleted`, `deleted → active`) |

Channel assignment is survivor-driven — channels are auto-provisioned to assigned counsellor and legal counsel on signup and on first channel list fetch. `findOrCreate` makes this idempotent.

### Community

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/community/rooms` | JWT | List rooms (sorted by latest activity) |
| POST | `/api/community/rooms` | JWT (NGO_ADMIN) | Create a room |
| POST | `/api/community/rooms/:roomId/join` | JWT | Join a room |
| GET | `/api/community/rooms/:roomId/messages` | JWT | Get room messages |
| POST | `/api/community/rooms/:roomId/messages` | JWT | Post a message |
| POST | `/api/community/messages/:messageId/report` | JWT | Report a message |
| DELETE | `/api/community/messages/:messageId` | JWT | Delete a message |
| GET | `/api/community/moderation/reports` | JWT (NGO_ADMIN) | List moderation reports |
| PATCH | `/api/community/moderation/reports/:reportId` | JWT (NGO_ADMIN) | Review a report (remove_message / ban_user / issue_warning) |

Survivors appear by nickname only in room timelines. `ban_user` sets `accountStatus=BANNED` with full metadata and resolves the underlying report atomically.

### Admin

All admin routes require a JWT.

#### NGO Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/ngo/dashboard` | KPIs, case triage, staff workload, resource analytics |
| PATCH | `/api/admin/ngo/reassignments` | Reassign a survivor's staff |
| POST | `/api/admin/ngo/resources` | Create a support resource |
| PATCH | `/api/admin/ngo/resources/:resourceId` | Update a support resource |
| POST | `/api/admin/ngo/staff` | Provision a new staff account (COUNSELLOR / LEGAL_COUNSEL / NGO_ADMIN) |
| PATCH | `/api/admin/ngo/staff/:userId/status` | Toggle staff ACTIVE / SUSPENDED |
| PATCH | `/api/admin/ngo/users/:id/ban` | Ban a user account |
| PATCH | `/api/admin/ngo/users/:id/unban` | Lift a ban |
| GET | `/api/admin/search` | Search users/staff |

#### System Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/system/dashboard` | Infrastructure status, uptime, DB latency, audit logs, staff directory |
| GET | `/api/admin/system/logs` | Audit log entries |
| POST | `/api/admin/system/runtime-action` | CLEAR_CACHE or RESTART_SERVER |
| POST | `/api/admin/system/maintenance-mode` | Enable / disable maintenance mode |

### Profile and Reassignment Requests

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/profile` | JWT | Get authenticated user's profile |
| PATCH | `/api/profile` | JWT | Update profile fields |
| POST | `/api/reassignment-requests` | JWT | Submit a staff reassignment request |
| GET | `/api/reassignment-requests` | JWT | List reassignment requests |
| PATCH | `/api/reassignment-requests/:id` | JWT (NGO_ADMIN) | Approve or reject a request |

---

## Socket Events

### Direct Chat (`chatSocket`)

JWT-authenticated. Server stores and relays only encrypted payloads — plaintext never leaves the client.

Client emits:

| Event | Payload |
|-------|---------|
| `joinChannel` | `chatId` |
| `sendEncryptedMessage` | `{ chatId, encryptedPayload }` |

Server emits:

| Event | Payload |
|-------|---------|
| `receiveMessage` | Saved message object |
| `messageError` | `{ error }` |
| `presence:update` | `{ userId, status }` |
| `message:delivered` | `{ messageId, deliveredAt }` |
| `message:seen` | `{ chatId, seenAt }` |

On connect: joins `user:<userId>` personal room, marks presence online, runs delivery catch-up (bulk-sets `deliveredAt` for messages received while offline). On disconnect: marks presence offline.

### Community (`communitySocket`)

| Event | Direction | Description |
|-------|-----------|-------------|
| `joinCommunityRoom` | Client → Server | Join a room's broadcast group |
| `joinModerationFeed` | Client → Server | Subscribe to moderation events |
| `community:new-message` | Server → Client | New message broadcast |
| `community:message-updated` | Server → Client | Message edited or moderated |
| `community:message-deleted` | Server → Client | Message deleted |
| `community:report-created` | Server → Client | New moderation report |
| `community:report-reviewed` | Server → Client | Report actioned |
| `community:error` | Server → Client | Error feedback |

### Notifications

Real-time notifications are pushed to the user's personal `user:<userId>` room via the `notification:new` event. The frontend also polls every 30 seconds as a fallback.

---

## Testing

```bash
npm test               # Full test suite (runs serially with --runInBand)
npm run test:auth      # Auth controller tests only
npm run test:system    # System route smoke tests
npm run test:watch     # Jest watch mode
```

---

## Demo Accounts (Seeded)

| Role | Phone | Password |
|------|-------|----------|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Port conflict on 5000 | Kill the existing process: `fuser -k 5000/tcp` |
| 503 on all requests | Maintenance mode is active — check `/api/system/public-status` |
| Login denied with suspension error | `accountStatus` is not `ACTIVE` |
| Repeated auth failures / locked out | Wait for lockout window (default 15 min) or reset password |
| "Data too long for column 'otpHash'" | `otpHash` column is narrower than 60 chars — run `ALTER TABLE userAccount MODIFY COLUMN otpHash VARCHAR(255)` or set `DB_SYNC_ALTER=true` for one boot |
| Evidence URL errors | Verify `CLOUDINARY_*` env vars |
| CORS failures | Align `FRONTEND_ORIGIN` with the active frontend URL |
| USSD shows AT default message | ngrok has disconnected or the AT callback URL is wrong — see `docs/ussd.md` |
| SMS OTP never arrives | Check `AFRICASTALKING_USERNAME` (`"sandbox"` routes to AT simulator, not real phones); set `SKIP_SMS_IN_DEV=true` to bypass SMS in dev |
