# Frontend

React + Vite frontend for authentication, library resources, staff resource management, confidential reporting, direct encrypted chat, community rooms, and moderation dashboard workflows.

## Tech Stack

- React
- Vite
- Axios
- Socket.io client
- Web Crypto API (browser-side message encryption/decryption)

## Setup

Install dependencies:

```bash
npm install
```

Configure environment variables in frontend/.env:

```bash
VITE_API_BASE_URL=http://localhost:5000
```

If VITE_API_BASE_URL is not set, frontend defaults to http://localhost:5000.

## Run and Build

Development:

```bash
npm run dev
```

Lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

Preview built app:

```bash
npm run preview
```

## Route Map

Routes are handled in src/App.jsx via lightweight path switching:

- / and /home: Landing page
- /library: Resource library
- /join: OTP and password authentication
- /reports: Incident reporting workflow
- /chat: Direct encrypted chat
- /community: Community rooms and reporting tools
- /moderation: NGO moderation dashboard

Route protection behavior:

- /chat, /community, /moderation, /reports require auth token.
- /moderation is role-gated in UI to NGO_ADMIN.
- Backend still enforces all permission checks even when UI hides routes.

## Session and Auth Behavior

- authToken is stored in localStorage after login.
- userId is stored in localStorage when backend returns it.
- JWT payload may carry id and userId claims; frontend accepts both.
- Quick Exit control clears authToken and userId before redirecting away.

## Reporting UI

Main implementation:

- src/pages/ReportingPage.jsx
- src/services/reports.js

Key behavior:

- Survivors can create, edit draft-state entries, upload evidence, withdraw, and delete their own reports.
- Staff roles can request status transitions from the dropdown, but backend is final authority on allowed transitions.
- Evidence upload uses multipart file field named file and enforces 15MB size in UI to match backend limits.
- Evidence links are opened through short-lived signed URLs fetched on demand.

## Resource Library and Management

Main implementation:

- src/pages/LibraryPage.jsx
- src/services/resources.js

Key behavior:

- Resource browsing is public and works without authentication.
- Search and category filtering are handled via /api/resources query params.
- Staff write actions (create/update/delete) are available through authenticated service methods and are enforced by backend RBAC.
- Resource write calls use multipart form-data with file field name file.
- Backend stores files in Cloudinary and returns stable resource metadata + delivery URL for listing.

## Direct Chat UI

Main implementation:

- src/pages/DirectChatPage.jsx
- src/utils/cryptoUtils.js

Key behavior:

- Loads authorized channels through bearer-token REST calls.
- Joins socket room for active chat channel.
- Decrypts historical and live ciphertext client-side.
- Encrypts outbound messages before socket emit.
- Sends best-effort read acknowledgements without interrupting chat flow on failure.
- Privacy mask auto-hides screen after inactivity and reopens on interaction.

Development note:

- In development mode, a demo transcript may be appended when channel history is sparse.

## Community and Moderation UI

Main implementation:

- src/pages/CommunityPage.jsx
- src/pages/ModerationDashboardPage.jsx

Key behavior:

- Joins selected community room and receives realtime create/update/delete events.
- Supports reporting harmful posts and self-delete for own posts.
- Moderation dashboard consumes report queues and review actions for NGO admins.

## Local Two-User Realtime Test

1. Start backend and frontend.
2. Open one normal browser window and one incognito window.
3. Log in as survivor in one, counsellor in the other.
4. Open /chat in both sessions and exchange messages.
5. Optionally open /community in both to validate realtime room events.

Seeded accounts:

- Survivor: +254711000001 / Survivor@2026!
- Counsellor: +254700000020 / Counsellor@2026!

## Troubleshooting

- Blank data lists: verify backend is running and VITE_API_BASE_URL points to the correct host/port.
- 401 responses: verify localStorage authToken exists and is current.
- Socket not receiving events: confirm token is set, room join occurs, and backend FRONTEND_ORIGIN allows your frontend URL.
- Decryption placeholders: legacy non-JSON ciphertext may not decrypt with current format expectations.
