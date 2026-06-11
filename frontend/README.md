# Frontend

React + Vite frontend for authentication, library resources, staff resource management, confidential reporting, direct encrypted chat, community rooms, and moderation dashboard workflows.

## Stack

- React
- Vite
- Axios
- Socket.io client
- Web Crypto API

## Setup

Install dependencies:

```bash
npm install
```

Create frontend env file:

```bash
VITE_API_BASE_URL=http://localhost:5000
```

Fallback behavior:

- when VITE_API_BASE_URL is missing, frontend defaults to http://localhost:5000

## Scripts

Development server:

```bash
npm run dev
```

Lint:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

Preview build:

```bash
npm run preview
```

## Routing and Role Resolution

Main route shell: src/App.jsx

Route layers:

- public routes for unauthenticated users
- role-aware mappings for NGO admin
- role-aware mappings for system admin

Protected route behavior:

- unauthenticated users are redirected to /join for protected paths
- backend remains source of truth for authorization

Role decoding:

- JWT role is decoded client-side for UI routing
- backend authorization still validates all access independently

## Session and Safety Controls

- authToken and userId are stored in localStorage after successful login
- quick exit button clears local auth state and redirects immediately
- quick exit auto-collapses during idle periods to reduce accidental taps

## Maintenance Mode UX

Main implementation: src/App.jsx

Behavior:

- app polls GET /api/system/public-status every 15 seconds
- if maintenance is enabled, non-system-admin users see maintenance screen
- maintenance screen shows:
	- reason
	- last update timestamp
	- expected return time
	- countdown

## Authentication UX

Main implementation: src/pages/AuthPage.jsx

Supported flows:

1. password sign-in
2. OTP sign-in
3. OTP signup + password setup
4. forgot password reset by OTP
5. forced first-login password reset for staff

Forced first-login reset flow:

- backend may return authStage=PASSWORD_RESET_REQUIRED
- frontend captures token from that response
- user must set a new password via /api/auth/set-password
- after successful update, frontend finalizes login and navigates to /home

## NGO Admin Workspace

Main implementation: src/pages/NgoAdminDashboardPage.jsx

Documented sections:

- Command Center
- Case Triage
- Reports
- Community Chat
- Team Capacity
- Moderation Desk
- Resources

Key capabilities:

- 30-day trend chart with daily values and moving average
- report filtering and status tabs
- manual survivor reassignment form
- moderation queue actions
- create/edit resource catalog entries
- resource analytics cards for top accessed resources and usage by category

## System Admin Workspace

Main implementation: src/pages/SystemAdminDashboardPage.jsx

Documented sections:

- Infrastructure
- Operational Logs
- Maintenance Control
- Admin Access

Key capabilities:

- infrastructure metrics and status badge
- live log stream polling
- maintenance controls with reason + expected return
- runtime actions (restart request and cache clear)
- staff creation form for all staff roles
- all staff directory with status actions
- suspend/reactivate confirmation modal with:
	- explicit confirm/cancel
	- ESC-to-close
	- click-outside-to-close

## Resource Library Tracking

Main implementation:

- src/pages/LibraryPage.jsx
- src/services/resources.js

Behavior:

- resource opens call track-access endpoint
- tracking runs best-effort and never blocks download/open actions

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

Behavior:

- only authenticated users can view community rooms
- NGO admins can create new rooms from the Community sidebar
- users must click Join Room before messages become visible
- survivors appear by nickname to other room participants
- moderation/report actions remain available in-room
- room list is ordered by latest activity (newest message first)
- chat view auto-scrolls to the latest message when entering a room

## Direct Chat Resume Behavior

Main implementation:

- src/components/SiteHeader.jsx
- src/pages/DirectChatPage.jsx

Behavior:

- Direct Chat resolves initial channel by: URL parameter, persisted channel, then API-most-recent fallback
- active chat selection is persisted back to localStorage and URL via history.replaceState

## Service Layer Reference

Admin service functions: src/services/admin.js

- getNgoAdminDashboard
- getSystemAdminDashboard
- runAdminSearch
- setMaintenanceMode
- getSystemLogs
- performSystemRuntimeAction
- createSystemStaffAccount
- updateSystemStaffStatus
- reviewModerationReport
- createNgoResource
- updateNgoResource
- reassignSurvivorCase

Resource service functions: src/services/resources.js

- getResources
- createResource
- updateResource
- deleteResource
- trackResourceAccess

## Realtime Validation (Two Users)

1. start backend and frontend
2. open standard and incognito windows
3. log in as two seeded users
4. test /chat and /community in parallel

Seeded users:

- Survivor: +254711000001 / Survivor@2026!
- Counsellor: +254700000020 / Counsellor@2026!

## Troubleshooting

- 401 responses: check authToken presence/expiry
- 403 login on staff: account may be suspended/deactivated
- maintenance screen always visible: verify backend maintenance mode status
- empty API lists: verify VITE_API_BASE_URL and backend process state
- missing live logs: confirm system admin token and /api/admin/system/logs reachability
