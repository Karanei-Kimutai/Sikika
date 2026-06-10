# Backend API

Express + Sequelize (MySQL) backend for authentication, chat, resources, and websocket relay.

## Tech Stack

- Node.js 18+
- Express
- Sequelize
- MySQL 8+
- Socket.io

## Setup

1. Install dependencies.

```bash
npm install
```

2. Create environment file.

```bash
cp .env.example .env
```

3. Set required environment variables in `.env`.

Core database:
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Authentication and messaging:
- `JWT_SECRET`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_USERNAME`

Optional but recommended for local development:
- `PORT` (defaults to `5000`)
- `FRONTEND_ORIGIN` (defaults to `http://localhost:5173`)
- `SKIP_SMS_IN_DEV=true` (enables development OTP bypass when not in production)

## Database

Create the database (if your MySQL user can create DBs, startup also auto-creates it):

```sql
CREATE DATABASE CSProjectDB;
```

Seed development data:

```bash
node src/seeders/index.js
```

Important:
- Seeding runs with `force: true` and drops/recreates tables.
- Use only in development.

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

## API Overview

Health:
- `GET /api/health`
- `GET /api/health/db`

Auth:
- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/login-password`
- `POST /api/auth/set-password` (requires bearer token)
- `GET /api/auth/session` (requires bearer token)

Chat:
- `GET /api/chat/channels` (requires bearer token)
- `GET /api/chat/:chatId/messages` (requires bearer token)

Resources:
- Mounted at `/api/resources`

## Recent Auth/Chat Behavior

- Phone numbers are normalized before auth lookup. Inputs like `+254 711 000 001` and `+254711000001` are treated as the same account.
- JWT includes both `id` and `userId` claims for compatibility with multiple consumers.
- Auth success responses now return `userId` and normalized `role`.
- Chat authorization resolves survivor membership correctly through `SurvivorProfile` mapping.

## Local Login Test Accounts (Seeded)

Password logins (development seed data):

- Survivor
  - Phone: `+254711000001`
  - Password: `Survivor@2026!`
- Counsellor
  - Phone: `+254700000020`
  - Password: `Counsellor@2026!`

These two accounts have a seeded direct chat channel and are useful for two-tab testing.

## Curl Examples

Password login:

```bash
curl -X POST http://localhost:5000/api/auth/login-password \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+254711000001","password":"Survivor@2026!"}'
```

Request OTP:

```bash
curl -X POST http://localhost:5000/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+254711000001"}'
```

Verify OTP:

```bash
curl -X POST http://localhost:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+254711000001","otp":"1234"}'
```

Get channels:

```bash
curl -X GET http://localhost:5000/api/chat/channels \
  -H "Authorization: Bearer <TOKEN>"
```

## Useful Commands

- `npm install`
- `node src/seeders/index.js`
- `npm run dev`
- `npm start`
