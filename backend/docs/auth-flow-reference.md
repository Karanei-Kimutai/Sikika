# Authentication Flow Reference

This document explains the current backend authentication design in practical terms.

## Core Principles

- Phone number is the login identifier.
- OTPs are purpose-bound and cannot be reused across flows.
- New users are treated as survivors by default.
- Role changes are not part of signup and remain admin-managed.

## Auth Intents

- SIGNUP_OTP: onboarding a first-time account.
- SIGNIN_OTP: OTP-based login for an existing account.
- PASSWORD_RESET: forgot-password reset flow.

## Auth Stages

- OTP_VERIFICATION_REQUIRED: OTP issued, client must verify.
- PASSWORD_SETUP_REQUIRED: OTP is valid but first password missing.
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

When a first-time signup verifies OTP with a valid new password:

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

- Request signup OTP, verify with password, confirm AUTHENTICATED.
- Confirm survivor profile was created for the new user.
- Confirm assigned counsellor and legal counsel IDs are set.
- Confirm a staff assignment history row was created.
- Confirm login-password and signin-OTP still work after signup.
- Confirm forgot-password request and reset still work.
