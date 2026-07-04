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

Browser E2E smoke tests (Playwright):

```bash
npx playwright install chromium
npm run test:e2e
```

Run E2E tests in headed mode:

```bash
npm run test:e2e:headed
```

## Routing and Role Resolution

Main route shell: src/App.jsx

Route layers:

- public routes for unauthenticated users
- role-aware mappings for NGO admin
- role-aware mappings for moderator

Protected route behavior:

- unauthenticated users are redirected to /join for protected paths
- backend remains source of truth for authorization

Role decoding:

- JWT role is decoded client-side for UI routing
- backend authorization still validates all access independently

## Frontend Architecture (Detailed)

### App Shell and Feature Composition

- `src/App.jsx` is the orchestration layer for route mapping, auth guards, and role-aware workspace routing.
- Feature pages are grouped by domain (`Auth`, `Community`, `Direct Chat`, `Admin Workspaces`, `Resources`, `Reports`) and each page owns its screen-level state.
- Shared top-level UI concerns (maintenance mode bannering, session redirects, quick-exit behavior) live in the app shell so every feature inherits the same safety behavior.

### API and State Boundaries

- UI components call backend through service modules (`src/services/*.js`) so endpoint URLs and auth header wiring remain centralized.
- Route/page components keep view state (loading flags, success/error messages, selected entities) local to the page to reduce cross-feature coupling.
- Backend remains the source of truth for permissions, account status, and moderation authority; frontend state only reflects server decisions.

### Auth Session Lifecycle

- On successful authentication, `authToken` and `userId` are persisted to `sessionStorage` (tab-scoped; cleared on tab close).
- Protected views derive session context from the token and redirect when session is missing/expired.
- First-login forced password reset is treated as an explicit intermediate auth stage before final navigation.

## Session and Safety Controls

- authToken and userId are stored in sessionStorage after successful login (tab-scoped, not shared across tabs)
- quick exit button clears local auth state and redirects immediately
- quick exit auto-collapses during idle periods to reduce accidental taps

## Maintenance Mode UX

Main implementation: src/App.jsx

Behavior:

- app polls GET /api/system/public-status every 15 seconds
- if maintenance is enabled, non-NGO-admin users see maintenance screen
- maintenance screen shows:
	- reason
	- last update timestamp
	- expected return time
	- countdown

## Authentication UX

Main implementation: src/pages/AuthPage.jsx

Supported flows:

1. password sign-in (step 1)
2. mandatory OTP 2FA verification after password match (step 2)
3. 3-step signup: request OTP -> verify OTP (signup ticket) -> complete signup details
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

- 30-day trend chart: gradient-filled bars (daily count) with a smooth bezier area + line overlay
  for the 7-day rolling average; peak day bar highlighted; shared Y-scale across bars, gridlines,
  and the trend path; all chart geometry produced by `buildLineChartPoints` in `helpers.js`
- Moderation Desk has two internal tabs (Reports Queue / Banned Users) managed by
  `ModerationDeskSection.jsx`; the Banned Users registry is co-located here rather than a
  standalone nav entry (see `BannedUsersSection.jsx`)
- report filtering and status tabs
- manual survivor reassignment form
- moderation queue actions (delete message, issue warning, ban user, lift ban)
- create/edit resource catalog entries
- resource analytics cards for top accessed resources and usage by category

## Moderator Workspace

NGO Admin is the only admin role — System Admin was removed. Moderator is a separate,
narrower staff role with delegated access to two sections only: Moderation Desk and
Community Chat.

Main implementation: src/pages/ModerationDashboardPage.jsx (also reused as the NGO
Admin's `/moderation` route), src/pages/CommunityPage.jsx, narrow nav via `moderatorRoutes`
in `App.jsx`.

Key capabilities:

- moderation queue actions (delete message, issue warning, ban user) — same
  `getModerationReports`/`reviewReport`/`deleteMessage` endpoints used by NGO Admin
- Community Chat oversight (room/message monitoring)
- does **not** have access to Team Capacity, Command Center, Staff Directory, USSD
  Callbacks, or the maintenance-mode toggle — those remain NGO_ADMIN-only

Maintenance mode now lives as a toggle
bar inside the NGO Admin dashboard, wired to the same `/api/admin/system/maintenance-mode`
endpoint, re-gated to `NGO_ADMIN`.

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
- Resource write calls use multipart form-data with file field name `file`.
- Backend stores files in Cloudinary. Files are **never** accessed via direct Cloudinary URLs — the View/Download button opens `GET /api/resources/:id/file`, which proxies the file through the backend and streams it to the browser. This is necessary because Cloudinary account-level security settings block direct delivery of raw authenticated assets.
- Resource opens also fire a best-effort `POST /api/resources/:id/track-access` call for analytics. This never blocks file access on failure.

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
- Survivor channel list is assignment-driven from backend auto-provisioned channels, so each survivor
  should see one counsellor channel and one legal-counsel channel when both assignments exist.
- Survivors can Archive, Restore, or Move to Trash any channel via the action menu (⋯) on each row.
  The Trash view (`includeDeleted=true` param) is toggled by the "Trash" button in the sidebar header
  and is survivor-only; staff never see deleted channels. Restoring from Trash transitions the channel
  back to `active` via `PATCH /api/chat/:chatId/status`.

Development note:

- Demo transcript injection is opt-in only via `VITE_ENABLE_CHAT_DEMO_TRANSCRIPT=true` (development mode only).
- If this env var is not enabled, chat history shows only real server-backed messages.

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
- moderation actions support rejecting reports, removing messages, issuing warnings, and banning users.

## Moderation Banning Semantics

- The `ban_user` action in `reviewModerationReport` sets `accountStatus = BANNED` with a reason,
  optional expiry, and a dual audit trail (ModerationActionLog + AuditLog). It also resolves the
  underlying content report atomically in the same transaction.
- The legacy `block_user`/`suspend_user` paths have been removed. `SUSPENDED` is now exclusively
  the operational Active/Inactive staff toggle in the Team Capacity section.
- Banned users are immediately evicted from active sockets; subsequent auth checks block access until
  the ban is lifted by an NGO admin via the Moderation Desk → Banned Users tab or the ban expires.
- Moderation actions are written to moderation logs for audit tracking.

## Direct Chat Resume Behavior

Main implementation:

- src/components/SiteHeader.jsx
- src/pages/DirectChatPage.jsx

Behavior:

- Direct Chat resolves initial channel by: URL parameter, persisted channel, then API-most-recent fallback
- active chat selection is persisted back to localStorage and URL via history.replaceState

## Service Layer Reference

Admin service functions: src/services/admin.js (NGO_ADMIN is the only admin role —
Legacy infra/logs/runtime-action calls were removed with the old role model)

- getNgoAdminDashboard
- runAdminSearch
- setMaintenanceMode (NGO_ADMIN-gated)
- createNgoStaffAccount / updateNgoStaffStatus
- banUser / unbanUser / listBannedUsers
- reviewModerationReport
- createNgoResource / updateNgoResource
- reassignSurvivorCase / getReassignmentSuggestions
- getMyReassignmentRequests / createMyReassignmentRequest / cancelMyReassignmentRequest
- getNgoReassignmentRequests / reviewNgoReassignmentRequest
- getUssdCallbackRequests / updateUssdCallbackRequest

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
- missing maintenance updates: confirm NGO admin token and /api/system/public-status reachability
- resource View/Download fails: backend proxies the file — confirm backend is running and Cloudinary env vars are set; see [docs/cloudinary.md](../docs/cloudinary.md)
