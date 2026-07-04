# Authentication Flow Reference

This document explains the current backend authentication design in practical terms.

## Core Principles

- Phone number is the login identifier.
- OTPs are purpose-bound and cannot be reused across flows.
- New users are treated as survivors by default.
- Role changes are not part of signup and remain admin-managed.

## Auth Intents

- SIGNUP_OTP: onboarding a first-time account.
- PASSWORD_RESET: forgot-password reset flow.

## Auth Stages

- OTP_VERIFICATION_REQUIRED: OTP issued, client must verify.
- DETAILS_REQUIRED: signup OTP verified; complete-signup details required.
- OTP_2FA_REQUIRED: password verified; signin OTP required.
- SIGNUP_REQUIRED: signin requested on an account that is not completed.
- SIGNIN_REQUIRED: signup requested for an already completed account.
- PASSWORD_RESET_OTP_REQUIRED: reset OTP has been requested.
- AUTHENTICATED: login completed and JWT issued.

## Security Controls

- OTP expiry time window.
- OTP attempt counters with lockout on repeated failures.
- Password mismatch counters with temporary lockout.
- Endpoint-level request rate limiting middleware.

## Survivor Auto-Assignment at Signup Completion

When a first-time signup completes successfully:

1. The account is finalized as a survivor account.
2. A survivor profile is created if none exists.
3. The system selects the least-loaded counsellor profile.
4. The system selects the least-loaded legal counsel profile.
5. Staff workload counters are incremented.
6. An initial staff assignment history record is written.

Important assumptions:

- Staff profiles already exist in the database.
- Staff profile creation is handled in NGO admin user-management flows.
- Signup does not promote users to staff roles.

## Manual Verification Checklist

- Request signup OTP, verify OTP, confirm signup ticket returned.
- Complete signup with ticket + password, confirm AUTHENTICATED.
- Confirm survivor profile was created for the new user.
- Confirm assigned counsellor and legal counsel IDs are set.
- Confirm a staff assignment history row was created.
- Confirm login-password returns OTP_2FA_REQUIRED and verify-2fa completes signin.
- Confirm forgot-password request and reset still work.
