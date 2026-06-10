# Frontend

React + Vite frontend for authentication, resource library, and secure direct chat.

## Tech Stack

- React
- Vite
- Axios
- Socket.io client

## Setup

1. Install dependencies.

```bash
npm install
```

2. Configure environment variables.

Create `.env` in the frontend folder if needed:

```bash
VITE_API_BASE_URL=http://localhost:5000
```

If not set, the app defaults to `http://localhost:5000`.

## Run

Development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## App Routes

Client routes are handled in `src/App.jsx` without a router package:

- `/` or `/home` - Landing page
- `/library` - Resources library
- `/join` - OTP/password authentication page
- `/chat` - Direct encrypted chat page

## Authentication Notes

- Auth token is saved to localStorage as `authToken`.
- Auth user ID is saved as `userId` when returned by backend.
- Password login and OTP login both use the same backend auth APIs.
- Backend phone normalization allows users to log in even if they type spaces/dashes in phone numbers.

## Direct Chat Notes

- `src/pages/DirectChatPage.jsx` loads channels and messages using bearer token auth.
- JWT payload is decoded client-side to bootstrap identity (`userId`/`id`) and role labels.
- Historical messages are decrypted in-browser using utilities in `src/utils/cryptoUtils.js`.
- New messages are encrypted before sending over sockets.
- Current UI is WhatsApp-inspired but follows the project white/brown theme.

Important:
- Seeded legacy messages may display as unreadable placeholders because they are not stored in the current JSON ciphertext format expected by the decryptor.

## Two-User Local Test Workflow

1. Start backend and frontend.
2. Open normal browser tab and log in as survivor.
3. Open incognito tab and log in as counsellor.
4. Navigate both sessions to `/chat`.
5. Send messages in one tab and confirm live delivery in the other.

Seeded test accounts:

- Survivor: `+254711000001` / `Survivor@2026!`
- Counsellor: `+254700000020` / `Counsellor@2026!`

## Lint

```bash
npm run lint
```
