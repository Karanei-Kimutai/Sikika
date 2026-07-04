# Role-Based Access Control (RBAC)

This document describes the six user roles on the GBV Support Platform, the permissions each role holds, how the auth middleware enforces access control, and the account lifecycle states that can block access.

---

## Roles

The platform has five registered roles plus the unregistered visitor context:

| Role | `userRole` value | Profile table | Description |
|---|---|---|---|
| Survivor | `SURVIVOR` | `survivorProfile` | Primary beneficiary of the platform — files reports, chats with staff, accesses the library and community |
| Counsellor | `COUNSELLOR` | `counsellorProfile` | Assigned staff member who supports survivors through chat and report review |
| Legal Counsel | `LEGAL_COUNSEL` | `legalCounselProfile` | Assigned staff member who provides legal guidance, reviews reports, and drafts legal case documentation |
| NGO Admin | `NGO_ADMIN` | `ngoAdministratorProfile` | The sole admin role — manages staff, views analytics, moderates community content, controls maintenance mode |
| Moderator | `MODERATOR` | `moderatorProfile` | Community safety enforcer — reviews harmful content reports and applies bans/warnings. A delegated subset of NGO Admin responsibilities |
| Unregistered visitor | (no account) | — | Can access the public library and the emergency reporting intercept page (`/reports`) — no authenticated features |

**Important:** System Admin was removed from this platform. All capabilities that required a System Admin (including maintenance mode) are now handled by NGO Admin.

---

## Auth Middleware Chain

**File:** `backend/src/middleware/authMiddleware.js`

Every protected route goes through `authMiddleware`. The chain runs four steps on each request:

### Step 1 — Token Presence

Checks for `Authorization: Bearer <token>`. If absent:
- Routes under `/api/reports` return HTTP 401 with emergency contact information (survivor-protective fallback)
- All other routes return HTTP 401

### Step 2 — JWT Signature Verification

```js
decoded = jwt.verify(token, process.env.JWT_SECRET);
```

Rejects with HTTP 401 if the token is expired or has an invalid signature. The JWT payload carries both `id` and `userId` claims for backward compatibility.

### Step 3 — Real-Time Account Status Check (DB Lookup)

After verifying the signature, the middleware performs a live DB lookup:

```js
const user = await UserAccount.findByPk(userId, {
  attributes: ['userId', 'accountStatus', 'banReason', 'banExpiresAt']
});
```

This means bans, suspensions, and deactivations take effect **immediately** — on the very next request after an admin applies the status change — rather than waiting for the JWT to expire.

**Auto-lift of expired temporary bans:** Before applying status enforcement, the middleware calls `liftExpiredBan(user)`. If `banExpiresAt` is in the past, the account is restored to `ACTIVE` and the ban fields are cleared automatically. The user's next request succeeds.

### Step 4 — Status Enforcement

| Status | HTTP Response |
|---|---|
| `BANNED` | 403 with discreet reason and optional expiry |
| `SUSPENDED` | 403 — "This account is currently suspended. Please contact support." |
| `DEACTIVATED` | 403 — "This account has been deactivated." |
| `ACTIVE` | Pass — `req.user = decoded`, call `next()` |

If the DB lookup itself fails, the middleware fails closed with HTTP 401.

---

## Account Status Lifecycle

The `accountStatus` column on `userAccount` controls platform access. There are four states:

| Status | Who Sets It | Who Can Unset It | Notes |
|---|---|---|---|
| `ACTIVE` | Default at account creation; auto-restored on ban expiry | — | Normal access |
| `SUSPENDED` | NGO Admin via staff operational toggle (`updateNgoStaffStatus`) | NGO Admin | Reversible operational pause for staff. No metadata stored. Used for Active/Inactive staff toggle in the Team Capacity section |
| `DEACTIVATED` | (Currently not exposed via a UI action) | — | Soft-delete — data preserved for audit, account unreachable |
| `BANNED` | NGO Admin via `PATCH /api/admin/ngo/users/:id/ban`; or community moderation `reviewReport` with `action: ban_user` | NGO Admin via `PATCH /api/admin/ngo/users/:id/unban` | Safety enforcement — stores reason, timestamp, bannedByUserId, optional expiry |

### SUSPENDED vs BANNED

These two statuses are often confused. The key distinction:

| | SUSPENDED | BANNED |
|---|---|---|
| **Purpose** | Operational staff toggle (Active/Inactive) | Safety/moderation enforcement |
| **Metadata stored** | None | `banReason`, `bannedAt`, `banExpiresAt`, `bannedByUserId` |
| **Audit trail** | No | Yes — dual trail: `ModerationActionLog` + `AuditLog` |
| **Who it applies to** | Staff only (COUNSELLOR, LEGAL_COUNSEL, NGO_ADMIN, MODERATOR) | Any role in `BANNABLE_ROLES` |
| **Cascade effect** | None | If COUNSELLOR or LEGAL_COUNSEL: `cascadeReassignOnStaffBan` auto-reassigns their survivors |
| **Expiry** | No — manual toggle only | Optional — set `banExpiresAt` for temporary bans |
| **Socket eviction** | No | Yes — `disconnectSockets(true)` evicts active sessions immediately |

---

## BANNABLE_ROLES

**File:** `backend/src/utils/roles.js`

```js
const BANNABLE_ROLES = ['SURVIVOR', 'COUNSELLOR', 'LEGAL_COUNSEL'];
```

`NGO_ADMIN` and `MODERATOR` are intentionally excluded from the ban-eligible list. Removing an admin/moderator account requires a full staff deactivation workflow, not a moderation ban. Both ban endpoints (`adminController.js` ban endpoint and `communityController.js` `reviewReport` with `action: ban_user`) import and enforce this allow-list.

### cascadeReassignOnStaffBan

When a `COUNSELLOR` or `LEGAL_COUNSEL` is banned, `cascadeReassignOnStaffBan` (in `adminController.js`) automatically reassigns all of their active survivors to the next least-loaded ACTIVE staff member. This is triggered from both the admin ban endpoint **and** the community moderation ban action, so a counsellor banned for harmful community behaviour also loses their caseload.

---

## normalizeRole

**File:** `backend/src/utils/roles.js`

JWT payloads and older request bodies may carry role strings in non-canonical formats. `normalizeRole` converts any of these to a stable uppercase canonical form:

| Input | Output |
|---|---|
| `"legalCounsel"` | `"LEGAL_COUNSEL"` |
| `"ngoAdmin"` | `"NGO_ADMIN"` |
| `"SURVIVOR"` | `"SURVIVOR"` |
| `""` or falsy | `""` |

---

## Staff Account Provisioning

NGO Admin creates staff accounts via `POST /api/admin/ngo/staff` (`createStaffAccount`). The flow:

1. NGO Admin fills the staff onboarding form with role (`COUNSELLOR`, `LEGAL_COUNSEL`, or `MODERATOR`), phone number, and other profile fields
2. The backend creates a `userAccount` with a temporary password and `status = 'password_reset_required'`
3. On first login, the staff member enters the temporary password; the backend returns `authStage = PASSWORD_RESET_REQUIRED` and a short-lived JWT
4. The staff member calls `POST /api/auth/set-password` with their new password before accessing any features
5. On subsequent logins, the full password + mandatory 2FA flow applies

Both counsellors and legal counsel undergo the same provisioning flow. Moderators are also provisioned via this endpoint.

---

## Frontend Route Maps

**File:** `frontend/src/App.jsx`

The SPA router uses role-based route maps to control which pages each role can see. NGO Admin gets the full dashboard nav; Moderator gets a narrowed navigation of only their two allowed sections:

```js
// Moderator — restricted to two sections
const moderatorRoutes = {
  '/moderation': <ModerationDashboardPage ... />,
  '/community':  <CommunityPage ... />,
  // All other routes redirect to /moderation
};
```

Full-role route maps for Survivor, Counsellor, Legal Counsel, and NGO Admin include their respective pages (reporting, chat, library, admin dashboard, etc.).

Role is read from the JWT on the client side for routing decisions only. The backend re-validates the role on every API call independently. Client-side role reading is an optimisation for UX — it has no security implications.

---

## Permissions Matrix

The following matrix summarises the key operations available to each role. "✓" = allowed, "–" = not allowed.

| Operation | Unregistered | Survivor | Counsellor | Legal Counsel | Moderator | NGO Admin |
|---|---|---|---|---|---|---|
| View library resources | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit incident report | – | ✓ | – | – | – | – |
| View own reports | – | ✓ | – | – | – | – |
| View all reports (assigned survivors) | – | – | ✓ | ✓ | – | ✓ |
| Update report status | – | – | ✓ | ✓ | – | ✓ |
| Withdraw report | – | ✓ | – | – | – | – |
| Upload evidence | – | ✓ | – | – | – | – |
| Access direct chat | – | ✓ | ✓ | ✓ | – | – |
| Join community rooms | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Post in community rooms | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Flag community messages | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Review moderation reports | – | – | – | – | ✓ | ✓ |
| Delete community messages | – | – | – | – | ✓ | ✓ |
| Ban users | – | – | – | – | ✓ (BANNABLE_ROLES only) | ✓ (BANNABLE_ROLES only) |
| Unban users | – | – | – | – | – | ✓ |
| Upload support resources | – | – | ✓ | ✓ | – | ✓ |
| Manage support resources | – | – | – | – | – | ✓ |
| View NGO dashboard / analytics | – | – | – | – | – | ✓ |
| Manage staff accounts | – | – | – | – | – | ✓ |
| Reassign survivor cases | – | – | – | – | – | ✓ |
| Toggle maintenance mode | – | – | – | – | – | ✓ |
| Create community rooms | – | – | – | – | – | ✓ |
| View USSD callback queue | – | – | – | – | – | ✓ |
| Draft legal case documents | – | – | – | ✓ | – | – |
| Generate legal PDFs | – | – | – | ✓ | – | – |

---

## Role in JWT Payload

When a JWT is issued at login, the payload includes:

```json
{
  "id": "<userId>",
  "userId": "<userId>",
  "role": "SURVIVOR",
  "userRole": "SURVIVOR"
}
```

Both `id`/`userId` and `role`/`userRole` pairs are included for backward compatibility with older token consumers. `authMiddleware.js` accepts either `decoded.userId` or `decoded.id`. `normalizeRole` is called whenever a role claim is used in a permission check.

---

## Further Reading

- `backend/src/middleware/authMiddleware.js` — full auth middleware implementation
- `backend/src/utils/roles.js` — `normalizeRole` and `BANNABLE_ROLES`
- `backend/src/controllers/authController.js` — signup/signin flows, `liftExpiredBan`
- `backend/src/controllers/adminController.js` — staff management, ban/unban, `cascadeReassignOnStaffBan`
- `docs/authentication.md` — auth system detail
- `docs/data-model.md` — `userAccount` model and `accountStatus` field detail
