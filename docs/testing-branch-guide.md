# Testing Branch Guide (Beginner Friendly)

This file explains, in simple language, what we are doing in the `testing` branch and why.

## 1. Why this branch exists

We split testing work from production feature work so:
- we can experiment safely,
- we can learn and adjust tests without blocking feature delivery,
- teammates reviewing production logic do not get mixed test-only noise.

Think of this branch as a **practice + quality lab**.

## 2. What kind of testing we added

We currently have two main testing styles:

1. Backend API/system tests (Jest + Supertest)
- These test server routes and behavior directly.
- They run fast and check business rules.

2. Frontend end-to-end tests (Playwright)
- These simulate real user flows in a browser.
- They click buttons, fill forms, and verify the UI behavior end-to-end.

## 3. Smoke tests vs full E2E tests

Smoke tests:
- small set of core checks,
- quick confidence that app is not broken,
- useful for fast feedback.

Full E2E tests:
- wider feature coverage (auth, survivor flows, admin flows, profile/library),
- slower but stronger confidence,
- better before releases.

## 4. Why we use API mocks in E2E

In Playwright tests, we mock some API responses.

Why:
- tests become more stable,
- we can control exact scenarios,
- failures are easier to debug,
- we are not blocked by backend data/setup every time.

This does **not** replace backend tests. It complements them.

## 5. What "environment blockers" mean

Sometimes tests fail before test logic starts because the machine is missing browser dependencies.

Example from our setup:
- Chromium needed `libasound.so.2`.
- On Ubuntu 24 this came from package `libasound2t64`.

Lesson:
- if Playwright says browser cannot launch, fix system dependencies first.

## 6. Current testing files in this branch

Backend:
- `backend/tests/systemRoutes.test.js`

Frontend:
- `frontend/playwright.config.js`
- `frontend/tests/e2e/system-smoke.spec.js`
- `frontend/tests/e2e/auth-flows.spec.js`
- `frontend/tests/e2e/survivor-flows.spec.js`
- `frontend/tests/e2e/admin-flows.spec.js`
- `frontend/tests/e2e/profile-library-flows.spec.js`
- `frontend/tests/e2e/helpers/mocks.js`

Related docs/config updates:
- test scripts in package files,
- testing notes in README/docs.

## 7. How to run tests (simple steps)

### Backend tests
From `backend/`:

```bash
npm test
npm run test:system
```

### Frontend E2E tests
From `frontend/`:

```bash
npm run test:e2e
```

For headed mode:

```bash
npm run test:e2e:headed
```

If browser dependencies are missing, install Playwright/system deps first.

## 8. How to read a failing test

Use this order:
1. Check first error line (root cause is usually near top).
2. Decide if failure is environment, selector, mock mismatch, or real bug.
3. Fix one failure at a time.
4. Re-run only the affected spec first.
5. Run full suite after targeted fixes pass.

## 9. Safe workflow in this branch

Use this loop:
1. Change one small thing.
2. Run relevant test(s).
3. Commit small logical units.
4. Keep notes of what changed and why.

This makes reviews and debugging much easier.

## 10. What we will do next here

In this `testing` branch, we can now:
- keep improving coverage,
- stabilize flaky tests,
- refine mocks/selectors,
- document what each test protects.

Goal: make test behavior understandable even to someone new to testing.
