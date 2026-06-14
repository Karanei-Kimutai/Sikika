# Automated System Tests

This project now has three automated test layers:

1. Backend unit/controller tests
2. Backend system route smoke tests
3. Frontend browser E2E smoke tests (Playwright)

## Run Full System Test Sweep

From repository root:

```bash
cd backend && npm test && npm run test:system
cd ../frontend && npm run lint && npm run build && npm run test:e2e
```

## Coverage Snapshot

Backend system route smoke tests validate:

- public availability endpoints (`/api/hello`, `/api/health`, `/api/system/public-status`)
- auth guards on protected API surfaces
- report-specific unauthenticated survivor guidance payload
- invalid-token rejection behavior

Frontend E2E smoke tests validate:

- public landing-to-library navigation
- unauthenticated redirect from protected routes to `/join`
- password sign-in happy path shell navigation
- maintenance mode screen behavior for non-system-admin sessions

## Notes

- Playwright tests use API request interception for deterministic browser tests.
- To run E2E tests locally the first time, install browser binaries:

```bash
cd frontend
npx playwright install chromium
```
