# Backend API

Express + Sequelize (MySQL) backend for authentication, incident reporting, direct chat, community rooms, moderation, notifications, and websocket relay.

## Tech Stack

- Node.js 18+
- Express
- Sequelize
- MySQL 8+
- Socket.io
- Multer (multipart evidence uploads)
- Cloudinary (evidence storage and signed URLs)

## Backend Architecture

Main server bootstrap lives in backend/index.js and wires:

- REST routes
- shared auth middleware
- socket gateways for direct chat and community
- DB bootstrap and model sync

Socket namespaces are implemented through room naming conventions:

- Direct chat room: chatId
- Community room: community-room:<roomId>
- Community moderation feed: community-moderation

## Environment Variables

Copy example file first:

```bash
cp .env.example .env
```

Required:

- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASSWORD
- JWT_SECRET
- AFRICASTALKING_API_KEY
- AFRICASTALKING_USERNAME

Recommended for local development:

- PORT (default 5000)
- FRONTEND_ORIGIN (default http://localhost:5173)
- SKIP_SMS_IN_DEV=true (development OTP bypass)
- NODE_ENV=development

Required for evidence upload flow:

- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

Without Cloudinary config, reporting APIs still work but evidence upload/access endpoints return service-unavailable responses.

## Setup and Run

Install dependencies:

```bash
npm install
```

Start in development:

```bash
npm run dev
```

Start in production mode:

```bash
npm start
```

At startup, backend validates required environment variables, ensures the configured database exists, authenticates Sequelize, then syncs models.

## Database and Seeders

Manual DB creation is optional when DB user has CREATE DATABASE permission.

Optional SQL:

```sql
CREATE DATABASE CSProjectDB;
```

Seed sample data:

```bash
node src/seeders/index.js
```

Important seeding note:

- Seeder uses force sync and recreates tables.
- Use only in local/development environments.

## API Surface

### Health

- GET /api/hello
- GET /api/health
- GET /api/health/db

### Auth

- POST /api/auth/request-otp
- POST /api/auth/verify-otp
- POST /api/auth/login-password
- POST /api/auth/set-password (bearer token)
- GET /api/auth/session (bearer token)

Auth compatibility behavior:

- JWT includes both id and userId claims.
- Login responses include userId and canonical role.
- Phone numbers are normalized before account lookup.

### Resources

- GET /api/resources

### Reporting

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

Reporting workflow protections:

- Transition graph is explicit and validated server-side.
- Role permissions are checked separately from transition validity.
- Escalation to legal case requires legal counsel role and survivorConsent=true.

### Direct Chat

- GET /api/chat/channels
- GET /api/chat/:chatId/messages
- PATCH /api/chat/:chatId/read

Direct chat security behavior:

- Channel membership is validated for reads and socket sends.
- Server stores encrypted payloads as opaque ciphertext.
- Notifications are generated with discreet content.

### Community and Moderation

- GET /api/community/rooms
- POST /api/community/rooms
- POST /api/community/rooms/:roomId/join
- GET /api/community/rooms/:roomId/messages
- POST /api/community/rooms/:roomId/messages
- POST /api/community/messages/:messageId/report
- DELETE /api/community/messages/:messageId
- GET /api/community/moderation/reports
- PATCH /api/community/moderation/reports/:reportId

Community behavior notes:

- Survivors display pseudonymous nicknames in room timelines.
- Room membership gates message listing and socket room joins.
- NGO moderation actions are audit-logged.

## Socket Events

### Direct Chat Socket

Client emits:

- joinChannel(chatId)
- sendEncryptedMessage({ chatId, encryptedPayload })

Server emits:

- receiveMessage(savedMessage)
- messageError({ error })

### Community Socket

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

## Local Test Accounts

Seeded password logins:

- Survivor: +254711000001 / Survivor@2026!
- Counsellor: +254700000020 / Counsellor@2026!

These accounts are suitable for two-tab realtime chat validation.

## Troubleshooting

- Invalid or expired token: verify Authorization header uses Bearer token and JWT_SECRET matches token issuer.
- SMS failures in development: set SKIP_SMS_IN_DEV=true to enable OTP bypass behavior.
- Evidence upload unavailable: confirm Cloudinary variables are present and valid.
- CORS issues from frontend: confirm FRONTEND_ORIGIN matches the active frontend URL.
