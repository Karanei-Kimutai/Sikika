# Backend Auth Manual Test Playbook

Use this when validating authentication changes without GitHub workflow automation.

## Commands

Run from backend folder:

- npm install
- npm test
- npm run test:auth
- npm run test:watch

## Recommended Validation Routine Before Push

1. Run npm run test:auth for fast auth regression feedback.
2. Run npm test for full backend test suite coverage.
3. If auth controller or routes changed, verify the following manually with API client:
   - signup OTP request and verify with password
   - OTP signin for existing completed account
   - password signin success and failure behavior
   - forgot-password request and reset OTP flow
   - lockout and retry behavior where applicable

## Common Failure Causes and Fixes

- package.json and package-lock.json mismatch:
  - run npm install and commit updated lockfile.
- tests pass locally but fail due to stale dependencies:
  - remove node_modules and run npm install again.
- OTP tests become flaky:
  - ensure NODE_ENV=test and SKIP_SMS_IN_DEV=true in test environment.

## Why We Keep This Manual

- Team requested explicit control over when auth tests run.
- Developers can choose when to run full suite versus focused suite.
- Push and PR checks are not blocked by workflow queue or runner install issues.
