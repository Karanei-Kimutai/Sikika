# Backend

Express + Sequelize (MySQL) backend for authentication, support resources, incident reporting, direct chat, community rooms, moderation, notifications, and websocket relay.

- authentication and password reset flows
- role-aware admin operations for NGO admins and system admins
- incident reporting, evidence uploads, chat, community moderation
- operational controls such as maintenance mode, runtime actions, and audit logs

## Core Stack

- Node.js 18+
- Express
- Sequelize + MySQL
- Socket.io
- bcrypt
- JWT
- Multer (multipart evidence uploads)
- Cloudinary (evidence storage and signed URLs, plus support resource storage)

## Startup Responsibilities

Main bootstrap file: backend/index.js

On startup the server:

1. Loads environment config
2. Validates required env vars
3. Ensures DB exists
4. Authenticates Sequelize
5. Syncs models
6. Mounts REST routes and socket handlers
7. Applies global maintenance gate middleware

## Data Model Architecture

### How Models Are Defined

- Every table is defined as a Sequelize model in `backend/src/models/*.js`.
- Each model file defines:
- table columns and data types
- primary key strategy (UUID strings across most domain entities)
- nullability/defaults
- table-level comments and field-level comments used as schema documentation

Common examples:

- `userAccount.js` is the identity root for auth and role-based access.
- `survivorProfile.js`, `counsellorProfile.js`, `legalCounselProfile.js` extend user identity with role-specific domain fields.
- `incidentReport.js`, `evidenceFile.js`, `legalCaseFile.js` model the reporting and legal escalation flow.
- `directChatChannel.js` and `directChatMessage.js` model survivor-to-staff private chat.

### How Models Are Brought Together

- `backend/src/models/index.js` is the registry and association hub.
- It imports all model definitions, wires relationships (`hasOne`, `hasMany`, `belongsTo`), then exports both the models and `sequelize` instance.
- All controllers/services import models from this single hub to keep associations consistent.

Association highlights:

- `UserAccount` has one role profile (survivor/counsellor/legal/ngo admin/system admin).
- `SurvivorProfile` belongs to assigned counsellor and legal counsel.
- `IncidentReport` belongs to a survivor and has many evidence files.
- `DirectChatChannel` belongs to a survivor and a staff counterpart user account.
- `CommunityRoom` has memberships and messages; moderation/reporting tables reference those messages.

### How Tables Are Created

- Table creation happens at backend startup in `backend/index.js`.
- Boot flow:
- validates env
- creates the database if missing (`CREATE DATABASE IF NOT EXISTS`)
- authenticates Sequelize
- runs `db.sequelize.sync(...)` to create/update tables from model definitions

This keeps local development bootstrapping simple because schema setup is automatic once env is valid.

### How Seeding Works

- Seeder entrypoint: `backend/src/seeders/index.js`.
- Command: `node src/seeders/index.js`.
- Seeder uses `sequelize.sync({ force: true })`, which drops and recreates tables before inserting demo data.
- It seeds a full working graph:
- system + NGO admins
- counsellors + legal counsel
- survivors and assignment history
- reports/evidence/legal cases
- direct chat + community data
- notifications/resources/moderation/audit rows

Because force sync is destructive, use seeding only for local/disposable environments.

### Authentication-Specific Data Flow

- OTP/password auth state is persisted on `UserAccount` (OTP value/purpose/expiry, failure counters, lockout fields, password hash).
- On first-time survivor signup completion, auth flow can create missing survivor profile and auto-assignment records.
- That signup completion path can also auto-provision direct-chat channels, which is why auth and chat model consistency must stay aligned.

## Environment Variables

Copy env template first:

```bash
cp .env.example .env
```

Required:

- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- JWT_SECRET
- AFRICASTALKING_API_KEY
- AFRICASTALKING_USERNAME

Recommended:

- PORT (default 5000)
- FRONTEND_ORIGIN (default http://localhost:5173)
- NODE_ENV (development or production)
- SKIP_SMS_IN_DEV=true (dev-only OTP bypass)
- DB_SYNC_ALTER=false (leave false for stable local DB)
- ALLOW_ADMIN_RESTART=true enables admin-triggered process exit for supervised restart

Optional:

- DB_PASSWORD (omit only if your local MySQL user has no password)

Required for Cloudinary-backed uploads (evidence and support resources):

- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

Without Cloudinary config, reporting APIs still work but evidence upload endpoints and support-resource write endpoints return service-unavailable responses.

## Local Setup

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Run in production mode:

```bash
npm start
```

## Testing

Run full backend tests:

```bash
npm test
```

Run auth-focused tests:

```bash
npm run test:auth
```

Watch mode:

```bash
npm run test:watch
```

## Seed Data

Seeder command:

```bash
node src/seeders/index.js
```

Seeder warning:

- the seeder resets/syncs tables for demo data generation
- use in local or disposable environments only

## API Index

### Health and Status

- GET /api/hello
- GET /api/health
- GET /api/health/db
- GET /api/system/public-status

### Authentication

- POST /api/auth/request-otp
- POST /api/auth/verify-otp
- POST /api/auth/login-password
- POST /api/auth/forgot-password/request
- POST /api/auth/forgot-password/reset
- POST /api/auth/set-password (auth required)
- GET /api/auth/session (auth required)

Authentication behavior highlights:

- phone numbers are normalized before lookup
- OTP and password flows both support lockout protections
- JWT payload includes id and userId compatibility claims
- suspended/deactivated accounts are blocked from login
- staff created by NGO admin are flagged for forced password change on first login

First-login forced reset behavior:

- newly created staff accounts are marked with status=password_reset_required
- login still returns a token but authStage=PASSWORD_RESET_REQUIRED
- frontend must call POST /api/auth/set-password before entering the app
- set-password clears the first-login reset requirement

Operational intent:

- NGO admins can safely share temporary credentials during onboarding
- staff identity is verified at first login, then password ownership moves to the staff member
- this removes long-term shared-password risk while preserving rapid onboarding

### Admin Routes

All admin routes require auth token.

NGO admin endpoints:

- GET /api/admin/ngo/dashboard
- PATCH /api/admin/ngo/reassignments
- POST /api/admin/ngo/resources
- PATCH /api/admin/ngo/resources/:resourceId

System admin endpoints:

- GET /api/admin/system/dashboard
- GET /api/admin/system/logs
- POST /api/admin/system/runtime-action
- POST /api/admin/system/maintenance-mode

NGO staff lifecycle endpoints:

- POST /api/admin/ngo/staff
- PATCH /api/admin/ngo/staff/:userId/status

NGO staff lifecycle rules:

- endpoint caller must be an authenticated NGO_ADMIN account
- role creation is limited to COUNSELLOR and LEGAL_COUNSEL
- created staff are initialized with status=password_reset_required
- status transitions are limited to ACTIVE and SUSPENDED
- status endpoint only targets COUNSELLOR and LEGAL_COUNSEL accounts

Shared admin utility:

- GET /api/admin/search?q=...

### Resources

- GET /api/resources
- POST /api/resources/:resourceId/track-access
- POST /api/resources (bearer token, multipart file upload)
- PATCH /api/resources/:resourceId (bearer token, optional multipart file replacement)
- DELETE /api/resources/:resourceId (bearer token)

Resource access model:

- Read access is public: authenticated users and unregistered visitors can browse resources.
- Create, update, and delete are restricted to COUNSELLOR, LEGAL_COUNSEL, and NGO_ADMIN.
- Resource uploads are stored in Cloudinary and persisted with metadata for replacement/deletion cleanup.
- Update supports metadata-only edits or metadata + file replacement in one request.

Resource upload constraints:

- Multipart field name: file
- Max upload size: 20MB
- Allowed MIME types: PDF, DOC, DOCX, TXT, JPG, PNG, WEBP, MP3, WAV, MP4

Resource analytics behavior:

- each resource open can create a ResourceAccessEvent
- NGO dashboard returns top-accessed resources and usage by category

### Reports

- POST /api/reports
- GET /api/reports
- GET /api/reports/:reportId
- PATCH /api/reports/:reportId
- PATCH /api/reports/:reportId/withdraw
- DELETE /api/reports/:reportId
- PATCH /api/reports/:reportId/status
- POST /api/reports/:reportId/evidence
- GET /api/reports/:reportId/evidence/:evidenceId/access-url
- GET /api/reports/analytics/summary

### Chat and Community

Direct chat:

- GET /api/chat/channels
- GET /api/chat/:chatId/messages
- PATCH /api/chat/:chatId/read

Direct chat assignment behavior:

- Survivor channels are assignment-driven, not global.
- On survivor access (and during signup completion), backend ensures channels exist for assigned counsellor and assigned legal counsel.
- Channel creation is idempotent (`findOrCreate`) so repeated logins do not duplicate channels.
- Channel membership is enforced by survivorId/supportStaffCounterpartId access checks.

Community and moderation:

- GET /api/community/rooms
- POST /api/community/rooms (NGO_ADMIN only)
- POST /api/community/rooms/:roomId/join
- GET /api/community/rooms/:roomId/messages
- POST /api/community/rooms/:roomId/messages
- POST /api/community/messages/:messageId/report
- DELETE /api/community/messages/:messageId
- GET /api/community/moderation/reports
- PATCH /api/community/moderation/reports/:reportId

Moderation action behavior:

- `remove_message` replaces message content with a moderation-safe placeholder.
- `block_user` (alias of `suspend_user`) sets the target account status to `SUSPENDED`.
- `issue_warning` writes a moderation log entry without account suspension.
- All approved moderation actions write an audit-style moderation action record.

Community access model:

- only authenticated users can list rooms
- only NGO admins can create rooms
- users must explicitly join a room before reading messages
- survivors are rendered with nickname-only identities in room timelines
- room list responses include latestMessageDispatchTimestamp per room
- room list is sorted by latest activity (newest message first)

## Admin Feature Documentation

### NGO Admin Dashboard

Returned by GET /api/admin/ngo/dashboard:

- overview KPIs and trend percentage
- full 30-day report series (including zero-filled days)
- report breakdowns by category, status, and county
- urgent case list and moderation queue
- community room/message metrics
- staff workload and reassignment data
- posted resources and resource usage analytics

### System Admin Dashboard

Returned by GET /api/admin/system/dashboard:

- infrastructure status badge
- uptime and DB latency
- OTP gateway configuration status
- live audit-derived logs
- maintenance state (enabled, updatedAt, reason, expectedUntil)
- runtime action timestamps (last cache clear/restart request)
- system admin directory
- all staff directory with password-reset-required indicator

### Maintenance Mode

Controlled by POST /api/admin/system/maintenance-mode.

State fields:

- enabled
- updatedAt
- reason
- expectedUntil

Runtime behavior:

- middleware denies non-admin business traffic with HTTP 503
- /api/system/public-status remains accessible
- system admin routes remain accessible

### Runtime Actions

POST /api/admin/system/runtime-action supports:

- CLEAR_CACHE: records timestamp and audit entry
- RESTART_SERVER: records restart request, optionally exits process when ALLOW_ADMIN_RESTART=true

### Staff Lifecycle Management

Create staff:

- POST /api/admin/system/staff
- roles supported: COUNSELLOR, LEGAL_COUNSEL, NGO_ADMIN, SYSTEM_ADMIN
- automatically creates role-specific profile rows
- marks account for forced first-login password reset
- writes STAFF_ACCOUNT_CREATED audit entry

Update staff status:

- PATCH /api/admin/system/staff/:userId/status
- statuses supported: ACTIVE, SUSPENDED
- blocks suspending own active system admin account
- writes STAFF_ACCOUNT_SUSPENDED or STAFF_ACCOUNT_REACTIVATED audit entry

## Socket Events

Direct chat socket:

Client emits:

- joinChannel(chatId)
- sendEncryptedMessage({ chatId, encryptedPayload })

Server emits:

- receiveMessage(savedMessage)
- messageError({ error })

Community socket:

Client emits:

- joinCommunityRoom(roomId)
- joinModerationFeed()

Server emits:

- community:new-message
- community:message-updated
- community:message-deleted
- community:report-created
- community:report-reviewed
- community:error

## Demo Accounts (Seeded)

- Survivor: +254711000001 / Survivor@2026!
- Counsellor: +254700000020 / Counsellor@2026!

## Troubleshooting

- Port conflict on 5000: stop existing backend process using that port
- 503 maintenance responses: check /api/system/public-status for active maintenance state
- login denied with suspension error: verify accountStatus is ACTIVE
- repeated auth failures: wait for lockout window or reset password
- evidence URL issues: verify Cloudinary env vars
- CORS failures: align FRONTEND_ORIGIN with active frontend URL
