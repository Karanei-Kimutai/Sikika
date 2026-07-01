# NGO Admin Dashboard

The NGO Admin Dashboard is the operational hub for the platform's sole admin role. It consolidates KPI monitoring, case management, staff lifecycle, community moderation, and platform-level controls into a single route-driven workspace. Every section is backed by REST endpoints in `backend/src/controllers/adminController.js`; the frontend is in `frontend/src/pages/NgoAdminDashboardPage.jsx` with section-level components under `frontend/src/pages/ngo-admin/`.

---

## Architecture

`NgoAdminDashboardPage` owns all async state and handlers. It passes data and callbacks down as props to its section sub-components (`CommandCenterSection`, `TeamCapacitySection`, `ModerationDeskSection`, `UssdCallbacksSection`). The `AdminWorkspace` shell wraps all sections in a consistent layout frame.

**`showSidebar={false}`** — `AdminWorkspace` is always mounted with the sidebar hidden. Navigation for the NGO Admin role is handled by the top-level `SiteHeader` and the `ngoAdminRoutes` map in `App.jsx`, which routes each URL path directly to the correct `NgoAdminDashboardPage` instance with an `initialSection` prop. This means `/reports` opens the dashboard with the reports section pre-selected, `/staff` opens team-capacity, and so on, without needing an internal sidebar.

---

## Dashboard Sections

### Command Center (`id: "command-center"`)

The default landing view. Shows:

- **Live KPIs** — total reports, active cases, pending reports, resolved cases, total community messages, average counsellor response time in hours, average legal response time in hours.
- **Trend chart** — a smooth bezier line chart of report volume by date using gradient-filled bars (`CommandCenterSection.jsx`). The chart uses `--chart-*` CSS custom property tokens.
- **Average response-time KPIs** — computed in `adminController.js` by joining `IncidentReport` with `DirectChatMessage` (earliest message per report-assigned counsellor) and averaging the delta. Rendered as cards in this section.
- **Maintenance mode toggle** — see [Maintenance Mode](#maintenance-mode) below.

### Case Triage (`id: "case-triage"`)

Shows survivors with urgent or unresolved cases — those whose reports have a high priority flag or no counsellor response. Provides urgent routing controls so the NGO Admin can escalate or reassign directly from this view.

### Reports (`id: "reports"`)

Full table of all `IncidentReport` records across the platform. Columns include report status, priority, assigned counsellor, assigned legal counsel, and submission date. NGO Admin can update report status and view per-report evidence here. Status updates follow the 7-state machine enforced in `reportController.js`.

### Community Chat (`id: "community-chat"`)

Read-only oversight of community room activity. NGO Admin can see room membership counts, recent messages, and fire moderation actions (remove message, open ban modal) from this section. Uses the same `CommunityPage` component that regular users see but with `canModerate=true`.

### Team Capacity (`id: "team-capacity"`, `TeamCapacitySection.jsx`)

Five panels:

1. **Capacity snapshot** — pulse cards showing total staff, available staff, high-load staff, and partially-unassigned survivors.
2. **Workload distribution bars** — per-staff `currentWorkloadScore` rendered as horizontal bars.
3. **Staff directory** — list of all COUNSELLOR, LEGAL_COUNSEL, and MODERATOR accounts with their current `accountStatus` (Active/Inactive) and workload. Each row has **Toggle Active** and **Ban** controls. Active/Inactive toggle calls `PATCH /api/admin/ngo/users/:id/status` and sets `accountStatus=ACTIVE` or `SUSPENDED`.
4. **Create staff account form** — see [Staff Onboarding](#staff-onboarding) below.
5. **Manual survivor reassignment** — see [Reassignment Suggestion Flow](#reassignment-suggestion-flow) below.

### Moderation Desk (`id: "moderation-desk"`, `ModerationDeskSection.jsx`)

Two internal tabs managed by `ModerationDeskSection`:

- **Reports Queue** — table of pending `HarmfulContentReport` records (flagged community messages). Each row shows the message content, author, reporter, report reason, and three action buttons: Reject Report, Approve + Remove Message, Approve + Ban User.
- **Banned Users** — the Banned Users Registry, rendered inside `BannedUsersSection.jsx`. Has a role-filter dropdown (all roles / SURVIVOR / COUNSELLOR / LEGAL_COUNSEL), a table of banned accounts with ban reason, banned-by, optional expiry, and a **Lift Ban** control per row.

Banning from the Reports Queue passes `contentReportId` to `handleOpenBanModal` so that `handleSubmitBan` can call `reviewModerationReport` — which resolves the report atomically with the ban in a single transaction.

### Resources (`id: "resources"`)

Lists all `SupportResource` records with create/edit controls. NGO Admin can upload resource files (stored in Cloudinary as `type: authenticated`), set category and description, and delete resources. Access tracking events are best-effort (fire-and-forget).

### USSD Callbacks (`id: "ussd-callbacks"`, `UssdCallbacksSection.jsx`)

Displays all USSD callback requests received via the `*384#` shortcode. Each row shows the caller's phone number, the auto-assigned counsellor (`Assigned To`), request status, and PENDING/COMPLETED/CANCELLED controls. See [USSD Callback Queue](#ussd-callback-queue) below.

---

## Auto-Assignment Algorithm

**`getLeastLoadedStaff(ProfileModel, idField, excludeId)`** is the shared selector for both cascade reassignment and manual reassignment suggestions.

```js
// backend/src/controllers/adminController.js
async function getLeastLoadedStaff(ProfileModel, idField, excludeId) { ... }
```

It:
1. Queries the given profile model (`CounsellorProfile` or `LegalCounselProfile`) with an **inner join on `UserAccount`**.
2. Filters to `UserAccount.accountStatus = 'ACTIVE'` — this is the critical gate. A staff member whose account is `SUSPENDED` or `BANNED` passes all profile-level checks but fails here, so they are never returned as a candidate.
3. Excludes the `excludeId` (the staff member being replaced) so the same person is never re-suggested.
4. Orders by `currentWorkloadScore ASC` and returns the first result (lowest-load active staff).

This same function is used by:
- **`cascadeReassignOnStaffBan`** — automatic reassignment when a counsellor or legal counsel is banned.
- **`GET /api/admin/ngo/reassignments/suggestions?survivorId=`** — manual reassignment suggestion in the Team Capacity form.

The `availabilityStatus` field on profile models is intentionally **not** checked here. Banning or suspending a staff member only flips `UserAccount.accountStatus`; the profile's `availabilityStatus` is untouched. Without the inner join the selector could recommend a banned counsellor who has `availabilityStatus=AVAILABLE`.

---

## `cascadeReassignOnStaffBan`

When a COUNSELLOR or LEGAL_COUNSEL is banned, all survivors currently assigned to them must be re-routed to another staff member. `cascadeReassignOnStaffBan` handles this automatically.

**Triggered from two places:**

1. **Admin ban endpoint** — `PATCH /api/admin/ngo/users/:id/ban` in `adminController.js` calls `cascadeReassignOnStaffBan` after committing the ban transaction.
2. **Community moderation** — `reviewReport` in `communityController.js` with `action: "ban_user"` imports `cascadeReassignOnStaffBan` from `adminController.js` and calls it post-commit. This ensures a counsellor or legal counsel banned for harmful community behaviour also has their caseload reassigned — not just those banned via the admin panel.

The function:
- Determines whether the banned user is a COUNSELLOR or LEGAL_COUNSEL.
- Fetches all `SurvivorProfile` records where `assignedCounsellor` or `assignedLegalCounsel` matches the banned user.
- For each survivor, calls `getLeastLoadedStaff` to find the next-best active replacement.
- Updates `SurvivorProfile` and recalculates `currentWorkloadScore` on both old and new staff.
- Logs a `StaffAssignmentHistory` entry for each reassignment.

---

## Reassignment Suggestion Flow

Manual reassignment is available for NGO Admins who want to rebalance a specific survivor's support team.

**Endpoint:** `GET /api/admin/ngo/reassignments/suggestions?survivorId=<uuid>`

Returns `{ suggestedCounsellorId, suggestedLegalCounselId }` by calling `getLeastLoadedStaff` for each role, excluding the survivor's current assignments.

**In the UI (TeamCapacitySection):**
- The admin selects a survivor from the reassignment form dropdown.
- A `useEffect` fetches suggestions for the selected survivor.
- Suggestions appear as a "Recommended" badge next to the staff selector inputs.
- Clicking **Apply Suggestion** fills the form with the suggested IDs.
- The admin can ignore the suggestion and manually pick any active staff member.
- Submitting the form calls `POST /api/admin/ngo/reassign` which updates the survivor's profile, adjusts workload scores, and logs the change.

---

## Staff Onboarding

`POST /api/admin/ngo/staff` → `createNgoStaffAccount` in `adminController.js`.

Creates a new user account for a COUNSELLOR, LEGAL_COUNSEL, or MODERATOR:

1. Generates a UUID for the new account.
2. Hashes a temporary password with bcrypt.
3. Creates `UserAccount` with `status=password_reset_required`.
4. Creates the appropriate profile record (`CounsellorProfile`, `LegalCounselProfile`, or `ModeratorProfile`) with `currentWorkloadScore=0`.
5. For COUNSELLOR/LEGAL_COUNSEL: provisions a direct-chat channel with each existing survivor via `ensureAutoChannelsForSurvivor`.

**First login behaviour:** Because `status=password_reset_required` is set, the `login-password` endpoint returns `authStage=PASSWORD_RESET_REQUIRED` instead of the normal 2FA flow. The frontend routes the new staff member to a forced password-reset screen (`beginFirstLoginResetFlow` in `SignInFlow.jsx`). The temporary password is replaced before they can access any platform feature. After `set-password` succeeds, `finalizeLogin` is called with the token that was already issued, so they land on their role's default view.

---

## SUSPENDED vs BANNED

Both statuses block all authenticated access immediately (enforced by `authMiddleware` DB lookup on every request). The distinction matters for behaviour and semantics:

| | `SUSPENDED` | `BANNED` |
|---|---|---|
| Set by | Team Capacity → Toggle Active | Moderation Desk → Ban User / Admin ban endpoint |
| Metadata | None | reason, bannedByUserId, optional banExpiresAt |
| Audit trail | None | `ModerationActionLog` + `AuditLog` |
| Cascade reassignment | No | Yes (COUNSELLOR/LEGAL_COUNSEL only) |
| Auto-lift | No | Yes, if `banExpiresAt` is set (checked at next auth attempt) |
| Intent | Operational pause (staff out sick, on leave) | Safety / moderation enforcement |

`MODERATOR` and `NGO_ADMIN` are in the `BANNABLE_ROLES` allow-list exclusion — they cannot be banned via the community moderation path. They can still be suspended via Team Capacity.

---

## Maintenance Mode

Maintenance mode suspends access for all non-NGO_ADMIN sessions with an HTTP 503 response. The frontend shows a dedicated maintenance screen instead of normal app pages.

**Storage and caching:**

- State is persisted in the `SystemSetting` table under key `'maintenance'` as a JSON value `{ enabled, reason, expectedUntil, updatedAt }`.
- On boot, `loadMaintenanceStateFromDb()` reads this row and populates the in-process `_maintenanceCache` object.
- Every toggle (`setMaintenanceMode` endpoint) writes to `SystemSetting` AND updates `_maintenanceCache` atomically, so restarts resume from the last state.
- The request-level guard checks `_maintenanceCache.enabled` directly — no DB round-trip per request.

**Frontend polling:**
- `App.jsx` polls `GET /api/system/public-status` every 15 seconds.
- When `maintenanceMode.enabled` is true, the app renders the maintenance screen instead of the normal shell for all non-NGO_ADMIN sessions.
- `/join` is always reachable (excluded from the maintenance screen redirect) so an NGO Admin who is signed out can still authenticate and toggle maintenance off.

**Enabling via the dashboard:**

The Command Center section contains the maintenance toggle. When enabling, the admin optionally sets a `reason` and an `expectedUntil` timestamp. These are displayed to users on the maintenance screen and announced via `aria-live="polite"` for assistive technologies.

---

## USSD Callback Queue

When a survivor dials the USSD shortcode and requests a callback, `ussdController.js` creates a `UssdCallbackRequest` record and **auto-assigns it to the least-loaded available counsellor** via `pickLeastLoadedCounsellor` at creation time (the same active-account-join logic as `getLeastLoadedStaff`).

The NGO Admin sees the full queue in the USSD Callbacks section with the auto-assigned counsellor shown in the "Assigned To" column. The admin can:
- Mark a request COMPLETED or CANCELLED via the dropdown in each row.
- Reassign to a different counsellor by editing the assignment field.

The assigned counsellor sees their own queue in `MyCallbacksPage` (`/callbacks` route) and can update status themselves.
