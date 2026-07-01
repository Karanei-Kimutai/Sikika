# Frontend Architecture

This document describes the structural decisions behind the Sikika GBV Support Platform's React frontend. The architecture prioritises simplicity, survivor privacy, and a minimal dependency footprint over developer ergonomics.

**Key constraints that shape every decision here:**
- No React Router — custom `pushState`-based SPA router.
- No shared state — no Context API, no Zustand, no Redux. All state is component-local with prop drilling.
- No dark mode — single fixed light theme, always.
- Code-split heavy pages. Auth and landing are static (first-paint critical).

---

## Custom SPA Router

**File:** `frontend/src/App.jsx`

The router is implemented directly in `App.jsx` using the browser's native History API. There is no `react-router-dom` dependency.

### How routing works

`currentPath` state stores the resolved pathname. On mount, `getCurrentPath()` reads `window.location.pathname` and returns it if it exists in the `knownPaths` Set, otherwise falling back to `"/"` to prevent blank-page renders for unknown URLs.

```js
function getCurrentPath() {
  return knownPaths.has(window.location.pathname) ? window.location.pathname : "/";
}
```

Navigation is performed by the `navigate(path)` function, which:
1. Calls `window.history.pushState({}, "", path)` to update the browser URL bar without a page reload.
2. Sets `currentPath` to the result of `getCurrentPath()` (normalizes unknown paths to `"/"`).
3. Sets `locationVersion` to `window.location.pathname + window.location.search` (see [Query-String Remounts](#query-string-remounts) below).
4. Scrolls to the top of the page.

Browser back/forward button navigation is handled by a `popstate` listener:

```js
window.addEventListener("popstate", () => {
  setCurrentPath(getCurrentPath());
  setLocationVersion(window.location.pathname + window.location.search);
});
```

### `knownPaths` Set

All paths present in any of the three route maps are collected into a `Set`. This allows `getCurrentPath` to do a fast membership check rather than trying to look up the path in the active role's route map (which isn't known at that call site).

### Section-based navigation

Many "routes" are not separate pages but sections within a single large page component. `NgoAdminDashboardPage` is the primary example — it is one component that receives an `initialSection` prop and renders the correct internal panel. The URL `/reports` maps to `NgoAdminDashboardPage` with `initialSection="reports"`, not to a separate page. This means the component tree does not remount on section changes; only the internal state toggles.

---

## Role-Based Route Maps

Three route maps are defined in `App.jsx`:

### `publicRoutes`
Used by unauthenticated visitors and all standard authenticated roles (SURVIVOR, COUNSELLOR, LEGAL_COUNSEL). Contains all pages that any role may need.

### `ngoAdminRoutes`
Used when `role === "NGO_ADMIN"`. Remaps shared paths like `/`, `/home`, `/reports`, `/staff`, `/moderation`, and `/ussd-callbacks` to `NgoAdminDashboardPage` with the appropriate `initialSection`. Community and library pages still point to the same page components as public routes.

```js
const ngoAdminRoutes = {
  "/":            (props) => <NgoAdminDashboardPage {...props} initialSection="command-center" />,
  "/reports":     (props) => <NgoAdminDashboardPage {...props} initialSection="reports" />,
  "/staff":       (props) => <NgoAdminDashboardPage {...props} initialSection="team-capacity" />,
  "/moderation":  (props) => <NgoAdminDashboardPage {...props} initialSection="moderation-desk" />,
  ...
};
```

### `moderatorRoutes`
Used when `role === "MODERATOR"`. Intentionally narrow — only Moderation Desk and Community Chat are accessible. `/` and `/home` both resolve to `ModerationDashboardPage`. All other paths fall back to the same default.

### Route selection

`getRoutesForRole(role, isAuthenticated)` selects the active map:

```js
function getRoutesForRole(role, isAuthenticated) {
  if (!isAuthenticated) return publicRoutes;
  if (role === "NGO_ADMIN") return ngoAdminRoutes;
  if (role === "MODERATOR") return moderatorRoutes;
  return publicRoutes;
}
```

The `role` value is decoded from the JWT in sessionStorage using `decodeRoleFromToken()` — a client-side Base64 decode of the JWT payload with no signature verification. It is used only for UI routing; the backend enforces role guards independently on every API call.

---

## Auth-Gated Routing

`protectedPaths` is a `Set` of paths that require authentication:

```js
const protectedPaths = new Set([
  "/chat", "/staff", "/callbacks", "/community",
  "/profile", "/moderation", "/ngo-admin"
]);
```

If `currentPath` is in `protectedPaths` and `isAuthenticated` is false, the resolved path becomes `/join`.

**`/reports` is intentionally excluded.** Unauthenticated users who navigate to `/reports` receive a purpose-built emergency intercept screen (`UnauthReportIntercept`) inside `ReportingPage` rather than a redirect to `/join`. This ensures crisis contacts and emergency information are accessible without requiring an account.

---

## Session Management

Auth state is stored in `sessionStorage` (not `localStorage`):

- `authToken` — the JWT returned by the auth API.
- `userId` — the user's UUID.

`sessionStorage` is tab-scoped: it is cleared automatically when the tab is closed. This prevents a survivor's session from persisting in a shared or borrowed device.

On sign-out (`handleSignOut`) and quick-exit (`handleQuickExit`), both values are explicitly removed via `removeToken()` and `removeUserId()` from `frontend/src/utils/auth.js` before navigating away.

---

## No Shared State Policy

There is no Context API, no Zustand, no Redux, and no other global state mechanism in this application. Every piece of state is local to the component that owns it and is passed to children via props.

**Why:**
- **Simplicity** — no provider trees, no selector boilerplate, no store files to maintain.
- **Survivor privacy** — when a survivor navigates away from a page, that page's state is garbage-collected. There is no risk of one page leaking sensitive data (report details, chat messages) into another through a shared store.
- **No accidental cross-session leakage** — if two browser tabs somehow share the same JS heap, there is no global object that accumulates data from both sessions.
- **Data freshness** — because each component fetches its own data on mount, the displayed information is always current. There are no stale cache invalidation problems.

The trade-off is prop drilling. Deep component trees (e.g. `NgoAdminDashboardPage` → `TeamCapacitySection` → sub-forms) pass many props. This is accepted as a deliberate choice rather than a limitation.

---

## Maintenance Mode Polling

`App.jsx` runs a `setInterval` that calls `GET /api/system/public-status` every **15 seconds** and stores the result in `maintenanceMode` state.

When `maintenanceMode.enabled` is true and the current session is not `NGO_ADMIN`, the app renders a static maintenance screen instead of the normal shell. The maintenance screen always shows:
- Current maintenance reason (set by the NGO Admin).
- Last status update timestamp.
- Estimated return time and a live countdown via `formatMaintenanceCountdown`.

`/join` is excluded from the maintenance redirect so a signed-out NGO Admin can still authenticate and toggle maintenance off.

---

## E2EE Bootstrap

On every authenticated app load, `App.jsx` runs this sequence:

```js
getOrCreateKeyPair(userId)           // ensures an ECDH P-256 keypair in IndexedDB
  .then(({ publicKey }) => exportPublicKeyJwk(publicKey))  // export public half as JWK
  .then(registerPublicKey)           // PUT /api/chat/public-key
  .catch(() => { /* best-effort */ });
```

This is **idempotent** — `getOrCreateKeyPair` uses `indexedDB.getOrCreate`, so it returns the existing keypair if one already exists in this browser's IndexedDB for this `userId`. The registration call is a PUT (upsert) on the server.

If registration fails (network error, server down), the catch is silently swallowed. The consequence is that this user's counterparts will not be able to derive a shared chat key until the registration succeeds on a future page load. Messages will queue in `localStorage` via `pendingMessageQueue.js` and auto-send once the `chatKey:available` socket event is received.

---

## Quick Exit Button

The Quick Exit button (`button.app-quick-exit`) allows survivors to rapidly navigate away from the platform in an unsafe environment.

**Behaviour:**
1. Calls `removeToken()` and `removeUserId()` to clear the session.
2. Calls `window.location.replace(QUICK_EXIT_URL)` (Google) — `replace` overwrites the current history entry so Back does not return to Sikika.

**Auto-collapse:**
The button collapses 3 seconds after the last user activity (`mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`). This keeps the button from being visually prominent while the user is actively reading or typing. Any activity resets the 3-second timer and re-expands the button.

**Two-click safety:**
When the button is in the collapsed state, the first click expands it rather than triggering exit. This prevents accidental exits from incidental taps on a touch device.

---

## Code Splitting

Heavy page components are wrapped in `React.lazy()` and rendered inside `<Suspense>`:

```js
const LibraryPage        = lazy(() => import("./pages/LibraryPage"));
const DirectChatPage     = lazy(() => import("./pages/DirectChatPage"));
const CommunityPage      = lazy(() => import("./pages/CommunityPage"));
const NgoAdminDashboardPage = lazy(() => import("./pages/NgoAdminDashboardPage"));
```

`AuthPage` and `LandingPage` are **not** lazy — they are the first-paint experience for unauthenticated visitors and must be available synchronously. A lazy fallback flash on these pages would be worse than the small bundle cost.

`RouteLoadingFallback` is shown by `<Suspense fallback={...}>` while a lazy chunk loads. It renders shimmer skeleton cards using the same `.skeleton` CSS classes used in other loading states, so there is no new visual language introduced for route loading.

---

## PageTransition

Every route change wraps the incoming page in a subtle fade+lift entrance animation:

```js
function PageTransition({ path, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const mm = fadeInUp(ref.current, { y: 10, duration: 0.4 });
    return () => mm.revert();
  }, [path]);
  return <div ref={ref}>{children}</div>;
}
```

The component is **keyed by `finalPath`** — only a genuine route change (a path difference) triggers a re-run of the effect. Within-page section changes (e.g. switching from Command Center to Reports inside the NGO Admin Dashboard) do not change `finalPath`, so the animation does not replay.

All GSAP animations in the app are gated behind `gsap.matchMedia("(prefers-reduced-motion: no-preference)")` in `utils/motion.js`. Users with OS-level reduced-motion enabled see the final state immediately with no animation. The `PageTransition` `fadeInUp` helper is implemented via this system.

---

## SiteHeader

**File:** `frontend/src/components/SiteHeader.jsx`

Role-aware navigation bar. Rendered by `App.jsx` above the page area. Receives `currentPath`, `onNavigate`, `isAuthenticated`, `role`, and `onSignOut` as props.

Features:
- **Role-aware nav tabs** — different tab sets for NGO_ADMIN, MODERATOR, and standard roles. Active tab is highlighted by matching `currentPath`.
- **Edge-hover auto-scroll** — a `requestAnimationFrame` loop scrolls the tab list when the mouse is near the left or right edge. This handles overflow on narrow viewports without a scrollbar.
- **Hamburger drawer** — on viewports ≤ 680px, nav collapses to a hamburger button that opens a full-height drawer overlay.
- **Avatar dropdown** — profile summary card with sign-out button. Profile data is fetched lazily on the first open (not on every render).
- **NotificationBell** — encapsulated inside `SiteHeader`; handles its own polling and socket subscription internally.

---

## CSS Custom Property Token System

All colours, surfaces, and semantic values are defined as CSS custom properties on `:root` in `frontend/src/App.css`. Components use tokens, not hardcoded hex values.

Key token groups:
- `--surface`, `--surface-alt`, `--surface-raised` — background layers.
- `--community-*` — community room and message colours.
- `--legal-*` — legal case document colours.
- `--status-*` — report and case status indicator colours.
- `--chart-*` — dashboard chart colours and gradients.
- `--workspace-*` — admin dashboard layout colours.

**Single fixed light theme:**
There is no dark mode. An earlier `@media (prefers-color-scheme: dark)` override was intentionally removed so the platform UI looks identical regardless of the visitor's OS preference. `index.html` pins `<meta name="color-scheme" content="light">` so native browser form controls and scrollbars do not switch to dark mode either.

This is a deliberate choice for consistency on a platform used by survivors who may share devices or access the platform in public spaces.

---

## Query-String Remounts (Deep Links)

Notification-row clicks and socket events can navigate to paths with query parameters:

- `/chat?channel=<chatId>` — opens a specific chat channel.
- `/reports?reportId=<id>` — scrolls to and highlights a specific report.
- `/community?room=<roomId>` — joins and scrolls to a specific community room.

Pages read these query parameters **only on mount** using `new URLSearchParams(window.location.search)`. If the user is already on `/chat` and a notification pushes them to `/chat?channel=Y`, `currentPath` stays `"/chat"` — React would not re-render the page and the new query param would be ignored.

`locationVersion` solves this:

```js
const [locationVersion, setLocationVersion] = useState(
  () => window.location.pathname + window.location.search
);
```

The routed page is keyed by `locationVersion`:

```jsx
<Page key={locationVersion} onNavigate={navigate} role={role} onSignOut={handleSignOut} />
```

When `navigate("/chat?channel=Y")` is called while already on `/chat`, `locationVersion` changes from `"/chat"` to `"/chat?channel=Y"`. React sees a key change, unmounts the old page instance, and mounts a fresh one — re-running the mount-time query-param read with the new value.
