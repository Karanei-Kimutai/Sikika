# Testing Catalog: What We Currently Cover vs What To Add

This document mirrors your proposal style (Input/Action + Expected Output) and maps it to what the project currently tests.

## 1. Backend API Tests (Jest + Supertest)

### A. Authentication Flow (`backend/tests/authController.test.js`) — CURRENTLY COVERED

1. Request signup OTP for a new account
- Input: `POST /api/auth/request-otp` with phone number and signup intent.
- Expected Output: `200 OK`, `authStage=OTP_VERIFICATION_REQUIRED`, development OTP returned in test mode, user creation path called.

2. Block signup OTP request when account already has a password
- Input: `POST /api/auth/request-otp` for an account that is already complete.
- Expected Output: `409`, `authStage=SIGNIN_REQUIRED`.

3. Verify signup OTP and issue signup ticket
- Input: `POST /api/auth/verify-otp` with valid signup OTP.
- Expected Output: `200`, `authStage=DETAILS_REQUIRED`, `signupTicket` returned.

4. Complete signup with ticket + password
- Input: `POST /api/auth/complete-signup` with valid signup ticket and strong password.
- Expected Output: `200`, JWT token returned, password hash called, survivor profile + assignment history creation called.

5. Reject invalid OTP during sign-in
- Input: `POST /api/auth/verify-otp` with wrong OTP.
- Expected Output: `401 Unauthorized`, failure state persisted.

6. Password login success transitions to OTP 2FA
- Input: `POST /api/auth/login-password` with valid password.
- Expected Output: `200`, `authStage=OTP_2FA_REQUIRED`, no JWT yet.

7. Verify 2FA OTP and issue JWT
- Input: `POST /api/auth/verify-2fa` with valid OTP.
- Expected Output: `200`, `authStage=AUTHENTICATED`, JWT returned.

8. Password login failure
- Input: `POST /api/auth/login-password` with wrong password.
- Expected Output: `401 Unauthorized`, failure state persisted.

9. Forgot password request for unknown account
- Input: `POST /api/auth/forgot-password/request` for unknown number.
- Expected Output: `200 OK` with generic reset stage (prevents account enumeration leaks).

10. Reset password with valid OTP
- Input: `POST /api/auth/forgot-password/reset` with valid OTP and new password.
- Expected Output: `200 OK`, password updated and persisted.


### B. Role-Based Access Control / Security — COVERED

Current coverage (`backend/tests/systemRoutes.test.js`):

1. Protected routes without token
- Input: requests to protected endpoints with no Authorization header.
- Expected Output: `401 Unauthorized`.

2. Invalid bearer token
- Input: protected endpoint with invalid JWT.
- Expected Output: `401 Unauthorized`.

Current coverage (`backend/tests/rbac.test.js` and `backend/tests/systemRoutes.test.js`):

1. Survivor denied NGO admin dashboard access
- Input: `GET /api/admin/ngo/dashboard` with survivor token.
- Expected Output: `403`.

2. Survivor denied access to another survivor report
- Input: `GET /api/reports/:id` for a report not owned by caller.
- Expected Output: `403`.


### C. Incident Reporting API — COVERED

Current coverage (`backend/tests/reports.test.js` + route guards):
1. Unauthenticated report creation path behavior and emergency response envelope checks.
2. Authenticated report creation/update/status flows.
3. Ownership and survivor linkage validation paths.


### D. USSD Webhook (`ussd.test.js`) — COVERED

`backend/tests/ussd.test.js` exists on disk and covers the USSD webhook format.
1. `POST /api/ussd` with `text: ""` (new session) → `200` + response starts with `CON `.
2. Additional format and session-state assertions per the test file.


### E. Backend System Route Smoke (`backend/tests/systemRoutes.test.js`) — CURRENTLY COVERED

1. Public health endpoints
- Input: `GET /api/hello`, `GET /api/health`, `GET /api/system/public-status`.
- Expected Output: `200 OK` and expected payload shape.

2. Protected routes require auth
- Input: calls to chat/community/admin/profile/resource/report-related protected routes without auth.
- Expected Output: `401`.

3. Report route unauthorized payload shape
- Input: `GET /api/reports` without auth.
- Expected Output: `401` + emergency-contact guidance payload structure.


## 2. Frontend E2E UI Tests (Playwright)

### A. Auth Journeys (`frontend/tests/e2e/auth-flows.spec.js`) — CURRENTLY COVERED

1. Signup via OTP
- Action: open join page, switch to Sign Up, request OTP, verify OTP, set password/profile fields.
- Assertion: user lands on `/home`, authenticated shell visible.

2. Mandatory password + OTP 2FA signin
- Action: login-password then verify-2fa.
- Assertion: user lands on `/home`, authenticated shell visible.

3. Forgot-password reset
- Action: request reset OTP, submit OTP + new password.
- Assertion: success message shown.

4. Global 401 handling
- Action: an authenticated API call (via the shared `apiClient.js`) returns 401.
- Assertion: session is cleared and the app redirects to `/join`.


### B. Survivor Flows (`frontend/tests/e2e/survivor-flows.spec.js`) — CURRENTLY COVERED

1. Submit report and see it listed
- Action: fill report form and submit.
- Assertion: success message + report ID appears.

2. Join community room and report message
- Action: join room, open message menu, report message.
- Assertion: join success and report success messages.

3. Community composer double-submit guard
- Action: fill the composer, click Send, then attempt a rapid second click while the (delayed) request is still in flight.
- Assertion: Send button stays disabled for the whole in-flight window and exactly one message is posted.

4. Direct chat list load
- Action: open chat page.
- Assertion: chats render with expected survivor labels and archived toggle.


### C. Admin Flows (`frontend/tests/e2e/admin-flows.spec.js`) — CURRENTLY COVERED

1. NGO admin moderation action
- Action: open moderation details then issue warning.
- Assertion: moderation completion message shown.

2. NGO admin maintenance controls
- Action: enable/disable maintenance mode.
- Assertion: success message shown and dashboard state refreshes.

3. Lift Ban double-submit guard
- Action: click "Lift Ban" from the Moderation Desk queue.
- Assertion: the button shows a "Lifting…" loading state and all visible Lift Ban buttons disable for the duration of the request.


### D. Profile & Library Flows (`frontend/tests/e2e/profile-library-flows.spec.js`) — CURRENTLY COVERED

1. Survivor profile update
- Action: edit preferred nickname and save.
- Assertion: profile update success message.

2. Staff resource metadata edit
- Action: open edit form, change title, save.
- Assertion: resource update success message.


### E. System Smoke (`frontend/tests/e2e/system-smoke.spec.js`) — CURRENTLY COVERED

1. Public navigation
- Action: landing page -> browse resources.
- Assertion: library page content visible.

2. Anonymous protection behavior
- Action: navigate to protected chat route without auth.
- Assertion: join/auth UI is shown.

3. Maintenance mode UX
- Action: open app while maintenance is enabled.
- Assertion: maintenance screen visible.


### F. "Quick Exit" Safety Test (`safety.spec.js`) — COVERED

`frontend/tests/e2e/safety.spec.js` exists on disk and covers Quick Exit behavior.
1. Click Quick Exit → assert redirect to safe URL.
2. Assert session keys are cleared after exit, including the local `pendingMessages:<chatId>` queue and the IndexedDB E2EE keypair.
3. Sign out (not just Quick Exit) also purges any queued `pendingMessages:<chatId>` entries from `localStorage`.


## 3. Summary for Proposal (Simple)

What you can confidently claim as already implemented:
- Strong backend authentication test coverage.
- Backend unauthorized route/security smoke checks.
- Broad frontend E2E coverage for auth, survivor workflows, admin operations, and profile/library.
- Stable repeatable E2E runs (multiple green passes).

All four previously-missing suites now exist on disk:
- `backend/tests/rbac.test.js` — RBAC data-isolation tests ✅
- `backend/tests/reports.test.js` — reporting persistence tests ✅
- `backend/tests/ussd.test.js` — USSD webhook format tests ✅
- `frontend/tests/e2e/safety.spec.js` — quick-exit safety spec ✅

Additional suites also present (not listed in the original proposal but fully implemented):
- `backend/tests/banCascade.test.js` — cascadeReassignOnStaffBan auto-reassignment
- `backend/tests/banEnforcement.test.js` — ban metadata guards, liftExpiredBan, authMiddleware enforcement
- `backend/tests/chatPresence.test.js` — presence registry and delivery catch-up
- `backend/tests/socketAuthService.test.js` — unit tests for the shared `socketAuthService.js` helpers (JWT extraction from handshake, userId claim resolution, `isUserAccountActive` across ACTIVE/BANNED/SUSPENDED/missing-account/DB-error cases)
- `backend/tests/legalCaseController.test.js` — legal case workflow transitions
- `backend/tests/notificationController.test.js` — notification read/dismiss endpoints
- `backend/tests/notificationService.test.js` — notification write-path (notificationService)
- `backend/tests/chatTrashRestore.test.js` — chat Trash/Restore lifecycle (deleted → active, per-role access control)
- `frontend/tests/e2e/chat-trash-restore.spec.js` — E2E Trash view + Restore flow


## 4. Recommended Next Additions (order)

Proposal coverage is now complete. Future additions to consider:
1. End-to-end USSD session flow (multi-step USSD menu navigation).
2. Legal case document generation (pdfkit PDF endpoint).
3. Reassignment request approval/rejection flow.
