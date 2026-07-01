# API Reference

Complete reference for every REST endpoint exposed by the Sikika backend. All endpoints are prefixed with the backend base URL (default: `http://localhost:5000`).

## Authentication

Endpoints marked **Auth required** expect:

```
Authorization: Bearer <JWT>
```

The JWT is issued on successful 2FA verification (`POST /api/auth/verify-2fa`) and stored in `sessionStorage` on the frontend. It carries `userId`, `id` (legacy compat), and `role` claims.

## Rate Limiting

OTP issuance and auth-sensitive paths are rate-limited per IP:

- `otpRequestLimiter` — OTP request endpoints (higher abuse risk)
- `authSensitiveLimiter` — verify, login, and reset endpoints

---

## Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/request-otp` | No | Send an SMS OTP to a phone number (signup flow). Body: `{ phoneNumber, authIntent: "SIGNUP_OTP" }`. Returns `{ developmentOtp }` when `SKIP_SMS_IN_DEV=true`. |
| `POST` | `/api/auth/verify-otp` | No | Verify the signup OTP. Body: `{ phoneNumber, otp }`. Returns `{ signupTicket, authStage: "DETAILS_REQUIRED" }` on success. Returns `authStage: "SIGNIN_REQUIRED"` if the account already exists. |
| `POST` | `/api/auth/complete-signup` | No | Finish signup. Body: `{ phoneNumber, signupTicket, password, profileDetails: { displayNickname, assignedGender, residenceCounty, notificationsEnabled } }`. Creates `SurvivorProfile`, auto-assigns staff, provisions channels, issues JWT. |
| `POST` | `/api/auth/login-password` | No | Step 1 of sign-in. Body: `{ phoneNumber, password }`. On success: sends 2FA OTP, returns `{ authStage: "OTP_2FA_REQUIRED" }`. For staff needing a first-time reset: returns `{ authStage: "PASSWORD_RESET_REQUIRED", token, userId }`. |
| `POST` | `/api/auth/verify-2fa` | No | Step 2 of sign-in. Body: `{ phoneNumber, otp }`. Returns `{ token, userId }` on success. |
| `POST` | `/api/auth/forgot-password/request` | No | Request a password-reset OTP. Body: `{ phoneNumber }`. Avoids account enumeration (always returns 200). |
| `POST` | `/api/auth/forgot-password/reset` | No | Complete a password reset. Body: `{ phoneNumber, otp, newPassword }`. |
| `POST` | `/api/auth/set-password` | Yes | Set a new password (used for forced first-login reset). Body: `{ password }`. The JWT passed here is the temporary one returned by `login-password`. |

---

## Profile (`/api/profile`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/profile/me` | Yes | Returns `UserAccount` plus the caller's role-specific profile. Survivor gets `survivorProfile` (nickname, county, assigned staff); staff get their profile with workload and availability. |
| `PATCH` | `/api/profile/me` | Yes | Update mutable profile fields (availability, specialization, nickname, county). Immutable fields (userId, role, phone) are ignored. |

---

## Reports (`/api/reports`)

All endpoints require auth. Role-based access is enforced in the controller.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `POST` | `/api/reports` | Yes | SURVIVOR | Submit a new incident report. Body: `{ incidentType, incidentDescription, incidentDate, location?, perpetratorRelationship? }`. Creates report in `SUBMITTED` state. |
| `GET` | `/api/reports` | Yes | All | List reports. Survivors see only their own. Counsellors/legal counsel see reports for assigned survivors. NGO Admin sees all. |
| `GET` | `/api/reports/analytics/summary` | Yes | NGO_ADMIN | Returns aggregate KPIs: total reports, by-status counts, average response time, monthly trend. |
| `GET` | `/api/reports/:reportId` | Yes | Participants | Fetch a single report with evidence files and linked legal case. |
| `PATCH` | `/api/reports/:reportId` | Yes | SURVIVOR (own) | Update mutable narrative fields (`incidentDescription`, `location`, `incidentDate`). Cannot change status. |
| `PATCH` | `/api/reports/:reportId/withdraw` | Yes | SURVIVOR (own) | Transition report to `WITHDRAWN`. Irreversible from survivor side. |
| `DELETE` | `/api/reports/:reportId` | Yes | SURVIVOR (own) | Hard-delete a report. Only allowed in `SUBMITTED` state (before staff action). |
| `PATCH` | `/api/reports/:reportId/status` | Yes | Staff, NGO_ADMIN | Advance or transition the report through the 7-state machine. Body: `{ reportStatus, survivorConsent? }`. Triggers legal case auto-creation on `LEGAL_REVIEW` and `ESCALATED_TO_LEGAL_CASE`. |
| `POST` | `/api/reports/:reportId/evidence` | Yes | SURVIVOR | Upload evidence file. `multipart/form-data`, field name `file`, 15 MB limit. Stored privately in Cloudinary. |
| `GET` | `/api/reports/:reportId/evidence/:evidenceId/file` | Yes | Participants | Stream evidence file via backend proxy. Client should fetch as blob and create an object URL — raw Cloudinary URL is never sent. |

### Report status state machine

```
SUBMITTED → UNDER_REVIEW → ACTIVE_SUPPORT → UNDER_INVESTIGATION → LEGAL_REVIEW → ESCALATED_TO_LEGAL_CASE
                                                                               → RESOLVED
                                                                               → WITHDRAWN
```

---

## Direct Chat (`/api/chat`)

All endpoints require auth. Channel access is enforced per-call via `canUserAccessChannel`.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `GET` | `/api/chat/channels` | Yes | SURVIVOR, COUNSELLOR, LEGAL_COUNSEL | List caller's channels. Also idempotently creates missing auto-channels. Response includes `counterpartUserId`. |
| `GET` | `/api/chat/public-key/:userId` | Yes | Participants | Return the stored ECDH public key (JWK string) for the given userId. |
| `PUT` | `/api/chat/public-key` | Yes | All | Register or refresh the caller's ECDH public key. Body: `{ publicKey: "<JWK string>" }`. Emits `chatKey:available` to counterparts so pending message queues can drain. |
| `GET` | `/api/chat/:chatId/messages` | Yes | Participants | Fetch message history (oldest first). Triggers `seenAt` update on unread messages. |
| `PATCH` | `/api/chat/:chatId/read` | Yes | Participants | Mark all messages in channel as READ (sets `seenAt`). Emits `message:seen` socket events. |
| `PATCH` | `/api/chat/:chatId/status` | Yes | SURVIVOR (owner) | Change channel status. Body: `{ status: "active"|"archived"|"deleted" }`. |

---

## Community (`/api/community`)

All endpoints require auth.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `GET` | `/api/community/rooms` | Yes | All | List all rooms with the caller's membership status for each. |
| `POST` | `/api/community/rooms` | Yes | NGO_ADMIN | Create a new community room. Body: `{ roomName, roomDescription?, isPrivate? }`. |
| `POST` | `/api/community/rooms/:roomId/join` | Yes | All | Join a room (creates `RoomMembership` row). Required before the socket can subscribe to room events. |
| `GET` | `/api/community/rooms/:roomId/messages` | Yes | Members | Fetch message history for a room. |
| `POST` | `/api/community/rooms/:roomId/messages` | Yes | Members | Post a new plaintext message. Body: `{ content }`. Survivors appear by nickname only. |
| `POST` | `/api/community/messages/:messageId/report` | Yes | All | Flag a message as harmful content. Body: `{ reportReasonText }`. Creates a `HarmfulContentReport`. |
| `DELETE` | `/api/community/messages/:messageId` | Yes | MODERATOR, NGO_ADMIN | Remove a message. Broadcasts `community:message-deleted` socket event. |
| `GET` | `/api/community/moderation/reports` | Yes | MODERATOR, NGO_ADMIN | List harmful-content reports (all statuses). |
| `PATCH` | `/api/community/moderation/reports/:reportId` | Yes | MODERATOR, NGO_ADMIN | Review a flagged report. Body: `{ reviewStatus: "APPROVED"|"REJECTED", action: "remove_message"|"ban_user"|"issue_warning"|"none" }`. Atomically applies the action and resolves the report. `ban_user` triggers `cascadeReassignOnStaffBan` if target is staff. |

---

## Legal Cases (`/api/legal-cases`)

All endpoints require auth. Controller enforces LEGAL_COUNSEL role and assignment to the survivor.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `PATCH` | `/api/legal-cases/:legalCaseId` | Yes | LEGAL_COUNSEL | Save draft authoring fields. Body: any subset of `{ caseSummary, legalGrounds, reliefSought, recommendedActions }`. |
| `PATCH` | `/api/legal-cases/:legalCaseId/status` | Yes | LEGAL_COUNSEL | Advance case lifecycle. Body: `{ status }`. Valid statuses: `OPEN → UNDER_INVESTIGATION → READY_FOR_SUBMISSION → SUBMITTED → CLOSED`. |
| `POST` | `/api/legal-cases/:legalCaseId/document` | Yes | LEGAL_COUNSEL | Compile the current draft into a PDF and upload privately to Cloudinary. Returns the updated case record. |
| `GET` | `/api/legal-cases/:legalCaseId/document` | Yes | LEGAL_COUNSEL | Stream the generated PDF via backend proxy (client should use `responseType: blob`). |

---

## Admin (`/api/admin`)

All endpoints require auth. Controllers enforce `NGO_ADMIN` role.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/ngo/dashboard` | Yes | NGO_ADMIN | Returns KPIs, staff capacity list, USSD queue stats, report analytics, and active system settings. |
| `GET` | `/api/admin/search` | Yes | NGO_ADMIN | Global search across survivors, staff, and reports. Query param: `?q=<term>`. |
| `POST` | `/api/admin/system/maintenance-mode` | Yes | NGO_ADMIN | Toggle maintenance mode. Body: `{ enabled: boolean, message?: string, estimatedRestoreTime?: string }`. Persisted to `SystemSetting` table. |
| `POST` | `/api/admin/ngo/staff` | Yes | NGO_ADMIN | Onboard a new staff member. Body: `{ phoneNumber, firstName, lastName, role: "COUNSELLOR"|"LEGAL_COUNSEL"|"MODERATOR", password, profileDetails? }`. Returns temp credentials. |
| `PATCH` | `/api/admin/ngo/staff/:userId/status` | Yes | NGO_ADMIN | Toggle a staff member's operational status. Body: `{ status: "ACTIVE"|"SUSPENDED" }`. `SUSPENDED` is the Active/Inactive toggle (no metadata); does not ban. |
| `PATCH` | `/api/admin/ngo/reassignments` | Yes | NGO_ADMIN | Manually reassign a survivor's counsellor or legal counsel. Body: `{ survivorId, newCounsellorId?, newLegalCounselId? }`. |
| `GET` | `/api/admin/ngo/reassignments/suggestions` | Yes | NGO_ADMIN | Suggest least-loaded active staff for a survivor. Query: `?survivorId=<id>`. |
| `POST` | `/api/admin/ngo/resources` | Yes | NGO_ADMIN | Create a support resource. `multipart/form-data`. Fields: `title`, `description`, `category`, `file` (optional). |
| `PATCH` | `/api/admin/ngo/resources/:resourceId` | Yes | NGO_ADMIN | Update an existing resource. Same shape as create. |
| `PATCH` | `/api/admin/ngo/users/:userId/ban` | Yes | NGO_ADMIN | Ban a user. Body: `{ reason, expiresAt? }`. Only targets BANNABLE_ROLES (SURVIVOR, COUNSELLOR, LEGAL_COUNSEL, MODERATOR). Triggers cascade reassignment for staff bans. Evicts active sockets. |
| `PATCH` | `/api/admin/ngo/users/:userId/unban` | Yes | NGO_ADMIN | Lift a ban. Restores `accountStatus` to `ACTIVE`. |
| `GET` | `/api/admin/ngo/banned-users` | Yes | NGO_ADMIN | List all currently banned accounts with ban metadata. |

---

## Notifications (`/api/notifications`)

All endpoints require auth. All queries are scoped to the caller's own account.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications` | Yes | List visible (non-dismissed) notifications. Supports `?unreadOnly=true`. |
| `GET` | `/api/notifications/unread-count` | Yes | Lightweight unread count for badge polling. |
| `PATCH` | `/api/notifications/:notificationId/read` | Yes | Mark a single notification as READ. |
| `PATCH` | `/api/notifications/read-all` | Yes | Mark all of the caller's unread notifications as READ. |
| `PATCH` | `/api/notifications/:notificationId/dismiss` | Yes | Dismiss a notification (hidden from default list). Separate from read state. |

---

## Resources (`/api/resources`)

Browse and manage support resources. GET endpoints are **public** (no auth required); write endpoints require auth and RBAC.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `GET` | `/api/resources` | No | Anyone | List all support resources. Supports `?search=<term>&category=<cat>`. |
| `GET` | `/api/resources/:resourceId/file` | No | Anyone | Stream the resource file via backend proxy (unauthenticated — Library is public). |
| `POST` | `/api/resources` | Yes | NGO_ADMIN, COUNSELLOR, LEGAL_COUNSEL | Create a resource with optional file upload. `multipart/form-data`, 20 MB limit. |
| `PATCH` | `/api/resources/:resourceId` | Yes | NGO_ADMIN, COUNSELLOR, LEGAL_COUNSEL | Update a resource. |
| `DELETE` | `/api/resources/:resourceId` | Yes | NGO_ADMIN, COUNSELLOR, LEGAL_COUNSEL | Delete a resource (also removes from Cloudinary). |
| `POST` | `/api/resources/:resourceId/track-access` | Optional | Anyone | Record a resource-open analytics event. Token optional; records `null` accessor for anonymous opens. Best-effort — frontend fires and ignores failures. |

---

## USSD (`/api/ussd`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/ussd/callback` | No | Africa's Talking USSD webhook. Handles all menu interactions. No auth — request comes from AT servers. IP allowlist recommended in production. |
| `GET` | `/api/ussd/callback-requests` | Yes (NGO_ADMIN) | Full callback queue with auto-assigned counsellor. |
| `GET` | `/api/ussd/my-callback-requests` | Yes (COUNSELLOR) | Requests auto-assigned to the calling counsellor. |
| `PATCH` | `/api/ussd/callback-requests/:requestId` | Yes | NGO_ADMIN can fulfil any; counsellor can only fulfil their own assigned requests. Body: `{ status }`. |

---

## Reassignment Requests (`/api/reassignment-requests`)

Survivors can request reassignment of their assigned counsellor or legal counsel.

| Method | Path | Auth | Role(s) | Description |
|---|---|---|---|---|
| `GET` | `/api/reassignment-requests/me` | Yes | SURVIVOR | List the caller's own reassignment requests. |
| `POST` | `/api/reassignment-requests/me` | Yes | SURVIVOR | Submit a new request. Body: `{ requestType: "COUNSELLOR"|"LEGAL_COUNSEL", reason }`. |
| `PATCH` | `/api/reassignment-requests/me/:requestId/cancel` | Yes | SURVIVOR | Cancel a pending request. |
| `GET` | `/api/reassignment-requests/ngo` | Yes | NGO_ADMIN | List all pending reassignment requests. Supports `?status=PENDING`. |
| `PATCH` | `/api/reassignment-requests/ngo/:requestId/review` | Yes | NGO_ADMIN | Approve or reject a request. Body: `{ decision: "APPROVED"|"REJECTED", newStaffId? }`. |

---

## System (`/api/system`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/system/public-status` | No | Returns `{ maintenance: boolean, message?, estimatedRestoreTime? }`. Polled by the frontend every 15 seconds to detect maintenance mode. |

---

## Error Response Format

All error responses use the format:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:

| Code | Meaning |
|---|---|
| 400 | Validation error — missing or invalid fields |
| 401 | Missing or invalid JWT |
| 403 | Authenticated but insufficient role |
| 404 | Entity not found or access denied (intentionally ambiguous for anti-enumeration) |
| 423 | Account locked (too many failed auth attempts) |
| 429 | Rate limit exceeded |
| 503 | Maintenance mode active (non-admin request) or Cloudinary not configured |
