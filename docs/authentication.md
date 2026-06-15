# Authentication

This document covers how authentication works on the GBV Support Platform — sign-up, sign-in, password reset, forced password reset for provisioned staff, and all the security rules that apply across those flows.

---

## Overview

The platform supports two authentication methods:

| Method | When used |
|--------|-----------|
| OTP (SMS) + Password | Survivor sign-up and ongoing login |
| Password only | Faster login for users with an existing account |

Every authentication attempt ends with one of two outcomes:
- A 2-hour JWT is issued and stored in `sessionStorage` by the frontend.
- An `authStage` value is returned that tells the frontend exactly what to do next (show OTP input, show password setup, redirect to forced reset, etc.).

All auth logic lives in `backend/src/controllers/authController.js`.

---

## Auth Stages and Intents

Every auth response includes an `authStage` field. The frontend branches on this value rather than inspecting HTTP status codes or error strings.

| authStage | Meaning |
|-----------|---------|
| `OTP_VERIFICATION_REQUIRED` | OTP has been sent; show the OTP input. |
| `PASSWORD_SETUP_REQUIRED` | OTP verified for first-time signup; collect a password. |
| `PASSWORD_RESET_REQUIRED` | Account flagged for forced reset (staff provisioned by admin); block navigation until reset. |
| `SIGNUP_REQUIRED` | Phone has no account; redirect to sign-up. |
| `SIGNIN_REQUIRED` | Account exists; redirect to sign-in. |
| `PASSWORD_RESET_OTP_REQUIRED` | Forgot-password OTP sent; show OTP and new-password fields. |
| `AUTHENTICATED` | Auth complete; JWT issued; user may proceed. |

`authIntent` is the caller-supplied signal that tells the server which flow is being started:

| authIntent | Flow |
|------------|------|
| `SIGNUP_OTP` | New-account creation via OTP. |
| `SIGNIN_OTP` | OTP-based login for an existing account. |
| `PASSWORD_RESET` | Forgot-password OTP flow. |

---

## Sign-Up Flow

Sign-up is a two-step process: request an OTP, then verify it and set a password.

### Step 1 — Request OTP

**Endpoint:** `POST /api/auth/request-otp`  
**Body:** `{ phoneNumber, authIntent: "SIGNUP_OTP" }`

1. The phone number is normalized to E.164 format (e.g. `0711000001` → `+254711000001`).
2. The server looks up whether a `UserAccount` already exists for that number.
   - If it does **and has a password**: returns `409` with `authStage: SIGNIN_REQUIRED`. The account is already complete.
   - If it does **and has no password**: a prior sign-up attempt was abandoned. The server continues — no new account is created.
   - If it does **not exist**: a shell `UserAccount` is created immediately with `userRole: SURVIVOR` and `accountStatus: ACTIVE`. No password is set yet.
3. The lockout state is checked. If the account is locked from prior failures, `423` is returned with `retryAfterSeconds`.
4. A 4-digit OTP is generated, bcrypt-hashed (10 rounds), and stored on the account alongside `otpPurpose: "SIGNUP_OTP"` and a 10-minute expiry. The plaintext OTP is never persisted.
5. The OTP is sent via Africa's Talking SMS. In dev mode (`SKIP_SMS_IN_DEV=true`), it is returned in the response as `developmentOtp` instead.
6. Response: `{ authStage: "OTP_VERIFICATION_REQUIRED", authIntent: "SIGNUP_OTP" }`.

### Step 2 — Verify OTP and Set Password

**Endpoint:** `POST /api/auth/verify-otp`  
**Body:** `{ phoneNumber, otp, password, authIntent: "SIGNUP_OTP", profileDetails? }`

1. The account is fetched. If any unexpired temporary ban has now passed its expiry, it is auto-lifted before anything else.
2. Account status is checked — `BANNED`, `SUSPENDED`, and `DEACTIVATED` accounts are rejected with `403`. Banned accounts include the `banReason` and `banExpiresAt` in the response.
3. Lockout is re-checked.
4. The submitted OTP is validated:
   - `otpHash` must exist.
   - `otpPurpose` must match `SIGNUP_OTP` (prevents using a signin OTP to complete a signup).
   - The OTP must not be past its 10-minute expiry.
   - `bcrypt.compare` is run against the stored hash.
   - Each wrong guess increments `otpAttemptCount`. At 5 failures, the account is locked for 15 minutes and the OTP is voided — the user must request a new one.
5. Since this is a first-time account, `password` is required (minimum 8 characters). It is bcrypt-hashed and stored.
6. OTP state is cleared, `isOtpVerified` is set to `true`, and failure counters are reset.
7. Three side effects fire in a single Sequelize transaction:
   - **SurvivorProfile is created** with sanitized `profileDetails` (nickname, gender, county). If `profileDetails` is missing, safe defaults are used (`Survivor-<shortId>`, `UNSPECIFIED` for gender and county).
   - **Staff auto-assignment**: the counsellor and legal counsel with the lowest `currentWorkloadScore` are assigned. Both scores are incremented. Preference is given to staff who are `AVAILABLE` or `BUSY`; if all are `OFFLINE`, the lowest-scored staff is assigned anyway.
   - **`StaffAssignmentHistory` record** is written for audit purposes.
8. `ensureAutoChannelsForSurvivor` eagerly creates direct-chat channels to both assigned staff so they appear immediately on the survivor's chat page.
9. A 2-hour JWT is issued containing `{ id, userId, role }`.
10. Response: `{ authStage: "AUTHENTICATED", token, userId, role, authMethod: "OTP" }`.

---

## Sign-In Flows

### OTP Sign-In

The OTP sign-in flow uses the same two endpoints as sign-up, but with `authIntent: "SIGNIN_OTP"`.

**Step 1 — Request OTP:** `POST /api/auth/request-otp` with `{ phoneNumber, authIntent: "SIGNIN_OTP" }`.  
- If no completed account (no `hashedPassword`) is found, returns `409` with `authStage: SIGNUP_REQUIRED`.
- Otherwise, generates and sends the OTP as above.

**Step 2 — Verify OTP:** `POST /api/auth/verify-otp` with `{ phoneNumber, otp, authIntent: "SIGNIN_OTP" }`.  
- Runs the same OTP validation as sign-up.
- Since `hashedPassword` already exists, the first-time signup branch is skipped entirely — no profile creation, no staff assignment.
- A JWT is issued directly.

### Password Sign-In

**Endpoint:** `POST /api/auth/login-password`  
**Body:** `{ phoneNumber, password }`

1. Phone is normalized and the account is fetched.
2. If no account exists, or the account has no `hashedPassword`: returns `401` with a **generic** "Invalid credentials" message. The two cases are deliberately indistinguishable to prevent phone number enumeration.
3. Expired temporary ban is auto-lifted.
4. Account status check (BANNED/SUSPENDED/DEACTIVATED → `403`).
5. Lockout check (→ `423` with `retryAfterSeconds`).
6. `bcrypt.compare` against `hashedPassword`.
   - **Failure**: `registerPasswordFailure` increments `authFailedAttempts`. At 5 failures, the account is locked for 15 minutes (counter resets to 0 so the next lockout period starts fresh). Returns `401`.
   - **Success**: `clearPasswordFailureState` resets counters. JWT is issued.
7. If `status === 'password_reset_required'`: returns `authStage: PASSWORD_RESET_REQUIRED` with the token. Frontend must gate navigation until `POST /api/auth/set-password` is called.
8. Response: `{ authStage: "AUTHENTICATED", token, userId, role, authMethod: "PASSWORD" }`.

---

## Forgot Password Flow

Used when a user cannot remember their password and needs to reset it via SMS OTP.

### Step 1 — Request Reset OTP

**Endpoint:** `POST /api/auth/forgot-password/request`  
**Body:** `{ phoneNumber }`

- If no account with a password exists for that number, the server returns the **same HTTP 200 response** as if it had sent the OTP. This prevents callers from using this endpoint to discover which phone numbers are registered.
- For a real account: generates a 4-digit OTP with `otpPurpose: "PASSWORD_RESET"` and sends it via SMS.
- Response: `{ authStage: "PASSWORD_RESET_OTP_REQUIRED", authIntent: "PASSWORD_RESET" }`.

### Step 2 — Submit OTP and New Password

**Endpoint:** `POST /api/auth/forgot-password/reset`  
**Body:** `{ phoneNumber, otp, newPassword }`

1. Account is fetched. Must exist and have an existing `hashedPassword` (incomplete signup accounts cannot reset a password they never set).
2. `otpPurpose` must be `PASSWORD_RESET`. Using a signup or signin OTP here will be rejected.
3. OTP expiry and bcrypt validation run as in the other flows.
4. On success: `newPassword` is bcrypt-hashed and saved. All failure counters and lockout state are cleared. OTP state is cleared.
5. **No JWT is issued** — the user must sign in again with their new password.
6. Response: `{ message: "Password reset successful." }`.

---

## Forced Password Reset (Staff Accounts)

Staff accounts (Counsellor, Legal Counsel, NGO Admin, System Admin) are provisioned by an NGO or System Admin — they do not self-sign-up. When a staff account is created, it is given a temporary password and `status: 'password_reset_required'` is set on the `UserAccount`.

On first login (either password or OTP path):
- The server detects `status === 'password_reset_required'` and returns the JWT **plus** `authStage: PASSWORD_RESET_REQUIRED`.
- The frontend must block all navigation and show the "Set New Password" screen.
- The user submits a new password to `POST /api/auth/set-password`.
- On success, `status` is updated to `'active'` and normal navigation is permitted.

**Endpoint:** `POST /api/auth/set-password`  
**Body:** `{ password }`  
**Auth:** JWT required (via `Authorization: Bearer <token>` header).

This endpoint is also available to any authenticated user who wants to change their password mid-session, not just staff on first login.

---

## Security Rules

### OTP Security

- OTPs are **4 digits** (1000–9999), generated with `Math.random`.
- They are **bcrypt-hashed (10 rounds)** before storage. The plaintext is never written to the database.
- Each OTP carries a **purpose** (`otpPurpose`). A signup OTP cannot be used to reset a password, and vice versa — the server checks the purpose on every verify attempt.
- OTPs expire after **10 minutes** (`AUTH_OTP_TTL_MS`, default 600,000 ms). Expired codes are cleared on attempted use.
- Each OTP gets **5 verification attempts** (`AUTH_OTP_MAX_ATTEMPTS`). On exhaustion, the OTP is voided and the account is locked for 15 minutes. The user must request a new code.

### Password Security

- All passwords are **bcrypt-hashed (10 rounds)** before storage.
- Minimum length is **8 characters** at all entry points (signup, set-password, forgot-password reset).
- Password failures are counted per-account. After **5 consecutive failures** (`AUTH_LOGIN_MAX_ATTEMPTS`), the account is locked for **15 minutes** (`AUTH_LOCKOUT_MS`).
- Failure counters reset to 0 when the lockout is applied, so each lockout period starts fresh.

### Account Lockout

Both OTP and password failure paths share the same lockout fields (`authLockUntil`, `authFailedAttempts`) and the same limits. A locked account returns `HTTP 423` with `retryAfterSeconds` so the frontend can display a countdown.

### Account Status Enforcement

Every auth attempt (OTP or password) checks `accountStatus` before proceeding:

| accountStatus | Behaviour |
|---------------|-----------|
| `ACTIVE` | Full access permitted. |
| `SUSPENDED` | Blocked. Generic "suspended or deactivated" message. |
| `DEACTIVATED` | Blocked. Same generic message. |
| `BANNED` | Blocked. `banReason` and `banExpiresAt` surfaced in response. |

Bans can be **temporary** (with a `banExpiresAt` timestamp). At the start of every auth check, `liftExpiredBan` runs: if the ban has passed its expiry, the account is automatically restored to `ACTIVE` with all ban metadata cleared. No cron job required — it happens on the next login attempt.

### Account Enumeration Protection

Two endpoints deliberately obscure whether a phone number is registered:

- `POST /api/auth/forgot-password/request` — always returns `HTTP 200` with the same message whether or not an account exists.
- `POST /api/auth/login-password` — returns the same `HTTP 401 "Invalid credentials"` for both "no account" and "wrong password".

---

## JWT Tokens

- Signed with `JWT_SECRET` (env var, required).
- Expire after **2 hours**.
- Payload: `{ id, userId, role }`. Both `id` and `userId` carry the same value — `userId` is the primary field; `id` is included for backwards compatibility with older middleware.
- Stored in `sessionStorage` by the frontend (tab-scoped, cleared on tab close).
- Validated on every protected request by `authMiddleware`, which also re-checks `accountStatus` from the database so a ban or suspension takes effect immediately without waiting for the token to expire.

---

## Africa's Talking SMS Integration

OTPs are delivered via Africa's Talking SMS. The SDK is initialized once at module load with credentials from environment variables:

| Variable | Purpose |
|----------|---------|
| `AFRICASTALKING_API_KEY` | API key for the account. |
| `AFRICASTALKING_USERNAME` | Account username. Set to `"sandbox"` to use the AT sandbox environment. |
| `AFRICASTALKING_SENDER_ID` | Optional. Approved sender ID shown instead of a shared shortcode. |

### Sandbox vs Live

When `AFRICASTALKING_USERNAME` is `"sandbox"`, the SDK routes all calls to Africa's Talking's sandbox API (`https://api.sandbox.africastalking.com`). Messages are not delivered to real phones — they are captured in the Africa's Talking web dashboard simulator. The API response format is identical to production.

### Dev Bypass

When `SKIP_SMS_IN_DEV=true` and `NODE_ENV !== 'production'`, the Africa's Talking call is skipped entirely. The plaintext OTP is returned in the response body as `developmentOtp`. This is the recommended approach for local development.

If `SKIP_SMS_IN_DEV` is not set in development, the OTP is sent to the AT sandbox. No real SMS is delivered, but the server reports success — the OTP is only retrievable from the AT dashboard simulator.

### Delivery Verification

Africa's Talking can return `HTTP 200` while still rejecting a recipient. The server inspects the `SMSMessageData.Recipients` array in the response. A recipient is considered successful only when `status === 'success'` or `statusCode` is `100` or `101`. Any failure is surfaced as an error (or a non-fatal warning in non-production environments).

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret used to sign and verify JWT tokens. |
| `AFRICASTALKING_API_KEY` | Yes | — | Africa's Talking API key. |
| `AFRICASTALKING_USERNAME` | Yes | — | AT account username (`"sandbox"` for sandbox mode). |
| `AFRICASTALKING_SENDER_ID` | No | — | Approved SMS sender ID (shown instead of shortcode). |
| `SKIP_SMS_IN_DEV` | No | `false` | Set to `"true"` to skip SMS in non-production and return OTP in response. |
| `AUTH_OTP_TTL_MS` | No | `600000` | OTP validity window in milliseconds (default 10 min). |
| `AUTH_OTP_MAX_ATTEMPTS` | No | `5` | Max OTP verification attempts before lockout. |
| `AUTH_LOGIN_MAX_ATTEMPTS` | No | `5` | Max password failures before lockout. |
| `AUTH_LOCKOUT_MS` | No | `900000` | Lockout duration in milliseconds (default 15 min). |

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/request-otp` | None | Request a signup or signin OTP. |
| `POST` | `/api/auth/verify-otp` | None | Verify OTP; completes signup or issues signin token. |
| `POST` | `/api/auth/login-password` | None | Password-based signin. |
| `POST` | `/api/auth/forgot-password/request` | None | Request a password-reset OTP. |
| `POST` | `/api/auth/forgot-password/reset` | None | Submit reset OTP and new password. |
| `POST` | `/api/auth/set-password` | JWT | Set or change password for the authenticated user. |
