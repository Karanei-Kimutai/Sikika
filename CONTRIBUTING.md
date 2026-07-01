# Contributing to Sikika

Sikika is a Gender-Based Violence (GBV) support platform for Kenya. Contributions must meet a high quality bar to protect the safety and privacy of survivors who depend on this platform.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 LTS |
| npm | ≥ 9 |
| MySQL | ≥ 8.0 |

**Required setup before first run:**

1. Copy `backend/.env.example` to `backend/.env` and fill in the required variables (see the file for comments).
2. Create `frontend/.env`:
   ```env
   VITE_API_BASE_URL=http://localhost:5000
   ```
3. Set `SKIP_SMS_IN_DEV=true` in `backend/.env` to get OTPs in the API response body instead of SMS during local development.

---

## Running Locally

```bash
# Terminal 1 — backend (nodemon hot-reload on port 5000)
cd backend
npm install
npm run dev

# Terminal 2 — frontend (Vite dev server on port 5173)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Demo Credentials

The seeder creates the following accounts for local testing:

| Role | Phone | Password |
|---|---|---|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |
| Legal Counsel | +254700000030 | LegalCounsel@2026! |
| NGO Admin | +254700000010 | NgoAdmin@2026! |
| Moderator | +254700000001 | Moderator@2026! |

---

## Seeding the Database

```bash
cd backend
node src/seeders/index.js
```

**DESTRUCTIVE** — this drops and recreates every table, then inserts the demo data above. Run it only in local development to reset a dirty database. Never run it in a staging or production environment with real data.

---

## JSDoc Requirement

All new code — including fixes and small changes — must include thorough inline documentation. PRs without JSDoc on new code will be rejected.

### Rules

**Every function** must have a JSDoc block with:
- A one-line summary describing what the function does.
- `@param {Type} name` for every parameter (including destructured props).
- `@returns {Type}` describing what is returned (use `{void}` when nothing is returned).
- `@throws {Error}` if the function throws in a documented path.

**Every module** must have a module-level JSDoc header at the top of the file explaining the module's purpose and responsibilities.

**Every React component** must:
- Have a JSDoc block on the function with `@param {object} props`, and a `@param` line for each individual prop with its type.
- Have a `@returns {React.ReactElement}` line.
- Include `/** description */` JSDoc comments on `useState` calls for non-obvious state variables.

**Example — backend function:**

```js
/**
 * Selects the active staff member with the lowest workload score,
 * excluding the current assignee and any suspended or banned accounts.
 *
 * @param {import('sequelize').Model} ProfileModel - Sequelize model for the staff profile type.
 * @param {string} idField - FK field name on SurvivorProfile (e.g. "assignedCounsellor").
 * @param {string} excludeId - userId to exclude from results (the current assignee).
 * @returns {Promise<object|null>} The profile row of the recommended staff member, or null.
 */
async function getLeastLoadedStaff(ProfileModel, idField, excludeId) { ... }
```

**Example — React component:**

```jsx
/**
 * ConfirmDialog
 * Shows a modal confirmation prompt with configurable labels and a danger variant.
 *
 * @param {object}   props
 * @param {boolean}  props.isOpen       - Whether the dialog is mounted and visible.
 * @param {string}   props.title        - Dialog heading text.
 * @param {string}   props.message      - Body text describing the action to confirm.
 * @param {string}   [props.confirmLabel="Confirm"] - Label for the confirm button.
 * @param {string}   [props.cancelLabel="Cancel"]   - Label for the cancel button.
 * @param {Function} props.onConfirm    - Called when the user confirms.
 * @param {Function} props.onCancel     - Called when the user cancels or clicks the overlay.
 * @param {string}   [props.variant]    - "danger" applies destructive styling to the confirm button.
 * @returns {React.ReactElement|null}
 */
export default function ConfirmDialog({ isOpen, title, message, ... }) { ... }
```

---

## Code Style

Follow these conventions. They are **not** optional — reviewers will enforce them.

### No shared state

Do not introduce `React.createContext`, Zustand, Redux, Jotai, or any other global state mechanism. All state is component-local with prop drilling. This is a deliberate choice to prevent sensitive survivor data from leaking across the component tree or across sessions.

### No React Router

The application uses a custom `pushState`-based SPA router in `App.jsx`. Do not add `react-router-dom` or any other routing library.

### No dark mode

The platform uses a single fixed light theme defined in `frontend/src/App.css`. Do not add `@media (prefers-color-scheme: dark)` overrides. Do not add a theme toggle. Use existing CSS custom property tokens (`--surface`, `--community-*`, `--legal-*`, `--status-*`, etc.) for all colours — no hardcoded hex values.

### Comments

Default to **no comments**. Write a comment only when the **why** is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific external bug, behaviour that would surprise a future reader. Do not comment on what the code does (well-named identifiers do that). Do not reference ticket numbers, PR descriptions, or author names in comments.

### No premature abstractions

Do not introduce helper functions, utilities, or shared hooks unless the same logic appears three or more times. A small amount of repetition is better than a wrong abstraction. Do not add features, error handling, or fallbacks for scenarios that cannot happen in the current codebase.

---

## Schema Changes

**Do not run `ALTER TABLE` manually.** MySQL ENUM columns in particular are risky to alter by hand — if existing rows contain a value not present in the new ENUM definition, the operation truncates data.

Instead, add all schema changes as idempotent reconciliation steps in:

```
backend/src/utils/schemaCompatibility.js
```

This file runs automatically on every boot via `ensureSchemaCompatibility(sequelize)`. Each step must:
1. Run a data-backfill `UPDATE` first (migrate existing rows to valid values before altering the column).
2. Then run `MODIFY COLUMN` or `ADD COLUMN` as needed.
3. Be safe to run multiple times (check-before-apply pattern).

The boot-time log line will report `applied`, `skipped`, or `error` for each step. Check the log after deploying to a fresh environment.

---

## Testing

### Backend tests

```bash
cd backend
npm test          # runs all 13 test suites serially with --runInBand
npm run test:auth # single file: tests/authController.test.js
```

**All tests must pass before a PR is merged.** If you add a new feature or fix a bug that is testable, add a corresponding test. The test coverage map is in `docs/automated-system-tests.md` and `docs/testing-current-coverage-catalog.md`.

### Frontend linting

```bash
cd frontend
npm run lint
```

There are currently no frontend unit tests. The one pre-existing ESLint error in `ModerationDashboardPage.jsx` (line 101, `react-hooks/set-state-in-effect`) is known and tracked. Do not introduce additional lint errors.

---

## PR Checklist

Before opening a pull request, verify all of the following:

- [ ] JSDoc added for every new function, component, and module (see [JSDoc Requirement](#jsdoc-requirement))
- [ ] `npm test` passes in `backend/` (113 tests, 13 suites)
- [ ] `npm run lint` passes in `frontend/` with no new errors
- [ ] No manual `ALTER TABLE` — ENUM and column changes go through `schemaCompatibility.js`
- [ ] No new `localStorage` usage for sensitive data — private keys stay in IndexedDB (`keyStorage.js`), session tokens stay in `sessionStorage`
- [ ] PR title follows Conventional Commits: `type(scope): short description`
  - Examples: `feat(chat): add message reactions`, `fix(auth): handle OTP lockout edge case`, `docs(e2ee): clarify key loss behaviour`
- [ ] `CLAUDE.md` updated if the PR adds a new feature or marks a roadmap item complete
- [ ] `docs/pending-roadmap-items.md` updated if a previously-pending feature is now done

---

## Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description (≤72 chars)

Optional longer body explaining the why.
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

If the commit was written with AI assistance:

```
feat(chat): add pending message queue for keyless counterparts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Sensitive Areas

The following areas of the codebase require extra care:

| Area | Why |
|---|---|
| `backend/src/controllers/authController.js` | OTP hashing, JWT issuance, lockout logic, 2FA enforcement |
| `frontend/src/utils/cryptoUtils.js` | ECDH key derivation, AES-GCM encryption/decryption |
| `frontend/src/utils/keyStorage.js` | IndexedDB key persistence; private keys must never be extractable |
| `backend/src/sockets/chatSocket.js` | Per-send account status checks; delivery catch-up; presence updates |
| `backend/src/controllers/communityController.js` | Moderation actions, ban atomicity, cascade reassignment trigger |
| `backend/src/utils/roles.js` | `BANNABLE_ROLES` allow-list; changes here affect who can be moderation-banned |
| `backend/src/middleware/authMiddleware.js` | Every authenticated request passes through here; DB lookup on every request for ban/suspension enforcement |

When modifying these files, document every security-relevant decision as an inline comment.
