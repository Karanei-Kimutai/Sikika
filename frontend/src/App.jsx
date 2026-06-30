import { Suspense, lazy, useEffect, useRef, useState } from "react";
import axios from "axios";
import { getToken, getUserId, removeToken, removeUserId } from "./utils/auth";
import { deleteKeyPair, getOrCreateKeyPair } from "./utils/keyStorage";
import { exportPublicKeyJwk } from "./utils/cryptoUtils";
import { registerPublicKey } from "./services/chatKeys";
import { fadeInUp } from "./utils/motion";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import ReportingPage from "./pages/ReportingPage";
import ModerationDashboardPage from "./pages/ModerationDashboardPage";
import ManageProfilePage from "./pages/ManageProfilePage";
import MyCallbacksPage from "./pages/MyCallbacksPage";
import "./App.css";

// Code-split the heaviest route components (each pulls in its own large
// section/sub-view tree) so the initial bundle only ships what landing/auth
// needs. AuthPage and LandingPage stay static — they're the first paint for
// unauthenticated visitors and have no benefit from a lazy fallback flash.
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const DirectChatPage = lazy(() => import("./pages/DirectChatPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const NgoAdminDashboardPage = lazy(() => import("./pages/NgoAdminDashboardPage"));

/**
 * App.jsx
 * -------
 * Top-level application shell.
 *
 * Core responsibilities:
 * - route resolution and role-based route remapping
 * - auth-aware route gating for protected views
 * - global maintenance-mode screen switching
 * - quick-exit behavior for survivor safety
 */

const QUICK_EXIT_URL = "https://www.google.com";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000";

// Public route map for unauthenticated users and fallback routing. Also
// covers SURVIVOR/COUNSELLOR/LEGAL_COUNSEL sessions, which share this same
// page set (no dedicated role-specific route map needed for them).
const publicRoutes = {
  "/": LandingPage,
  "/home": LandingPage,
  "/library": LibraryPage,
  "/join": AuthPage,
  "/chat": DirectChatPage,
  "/reports": ReportingPage,
  "/community": CommunityPage,
  "/profile": ManageProfilePage,
  "/moderation": ModerationDashboardPage,
  "/ngo-admin": NgoAdminDashboardPage,
  // Only COUNSELLOR has a nav entry to this (USSD callback auto-routing
  // assigns COUNSELLOR only), but the route itself is harmless for other
  // roles to hit directly — the backend 403s anyone who isn't a counsellor.
  "/callbacks": MyCallbacksPage
};

// Role-specific route remapping used after successful authentication.
const ngoAdminRoutes = {
  "/": (props) => <NgoAdminDashboardPage {...props} initialSection="command-center" />,
  "/home": (props) => <NgoAdminDashboardPage {...props} initialSection="command-center" />,
  "/reports": (props) => <NgoAdminDashboardPage {...props} initialSection="reports" />,
  "/staff": (props) => <NgoAdminDashboardPage {...props} initialSection="team-capacity" />,
  "/community": CommunityPage,
  "/moderation": (props) => <NgoAdminDashboardPage {...props} initialSection="moderation-desk" />,
  "/ussd-callbacks": (props) => <NgoAdminDashboardPage {...props} initialSection="ussd-callbacks" />,
  "/library": LibraryPage,
  "/profile": ManageProfilePage,
  "/join": AuthPage
};

// Moderator scope is intentionally narrow — Moderation Desk + Community Chat
// oversight only, reusing the same pages NGO Admin uses for those features.
const moderatorRoutes = {
  "/": ModerationDashboardPage,
  "/home": ModerationDashboardPage,
  "/moderation": ModerationDashboardPage,
  "/community": CommunityPage,
  "/profile": ManageProfilePage,
  "/join": AuthPage
};

function NotFoundPage({ onNavigate }) {
  return (
    <main className="maintenance-page" role="main" aria-label="Page not found">
      <section className="maintenance-card">
        <p className="maintenance-pill">Not Found</p>
        <h1>Page Not Found</h1>
        <p className="maintenance-lead">The page you requested does not exist or has moved.</p>
        <div className="maintenance-actions">
          <button type="button" className="maintenance-btn maintenance-btn-secondary" onClick={() => onNavigate("/home")}>Go Home</button>
        </div>
      </section>
    </main>
  );
}

// Includes role-specific paths so getCurrentPath() doesn't fall back to "/"
// when an authenticated user lands on a route not present in publicRoutes.
const knownPaths = new Set([
  ...Object.keys(publicRoutes),
  ...Object.keys(ngoAdminRoutes),
  ...Object.keys(moderatorRoutes),
]);

function getRoutesForRole(role, isAuthenticated) {
  if (!isAuthenticated) return publicRoutes;
  if (role === "NGO_ADMIN") return ngoAdminRoutes;
  if (role === "MODERATOR") return moderatorRoutes;
  // NGO_ADMIN is the only admin role — System Admin has been removed.
  return publicRoutes;
}

// UI-only route gating helper; API authorization still happens on the backend.
function decodeRoleFromToken() {
  const token = getToken();
  if (!token) return "";

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function getCurrentPath() {
  return window.location.pathname;
}

function formatMaintenanceCountdown(value) {
  if (!value) return "";
  const ms = new Date(value).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "Expected return time reached";

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m remaining`;
}

/**
 * Suspense fallback shown only while one of the lazy-loaded route chunks
 * (LibraryPage, DirectChatPage, CommunityPage, NgoAdminDashboardPage) is
 * still downloading — typically a single fast request on a warm cache, so
 * this is a brief skeleton rather than a full spinner page. Reuses the
 * existing shimmer skeleton classes (already shown elsewhere, e.g. the NGO
 * dashboard's own data-loading state) so it doesn't introduce a new visual
 * language, and the shimmer animation itself already honors the global
 * reduced-motion reset in App.css.
 */
function RouteLoadingFallback() {
  return (
    <div style={{ padding: "1.5rem" }} aria-busy="true" aria-label="Loading page">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    </div>
  );
}

/**
 * Wraps the active route's page in a subtle fade/lift entrance.
 * Keyed by `path` so every navigation (a genuine route change, not a
 * within-page state update) replays the animation once.
 */
function PageTransition({ path, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const mm = fadeInUp(ref.current, { y: 10, duration: 0.4 });
    return () => mm.revert();
  }, [path]);

  return <div ref={ref}>{children}</div>;
}

function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  // Full pathname+search, used only as a remount key for the routed page —
  // currentPath above stays pathname-only for route-matching. Without this,
  // a notification deep-link that changes only the query string (e.g.
  // /chat -> /chat?channel=Y while already on /chat) leaves currentPath
  // unchanged, so React never re-renders and the target page's mount-time
  // query-param reads never re-run.
  const [locationVersion, setLocationVersion] = useState(
    () => window.location.pathname + window.location.search
  );
  const [isQuickExitCollapsed, setIsQuickExitCollapsed] = useState(false);
  const quickExitIdleTimerRef = useRef(null);
  const isAuthenticated = Boolean(getToken());
  const role = decodeRoleFromToken();
  const [maintenanceMode, setMaintenanceMode] = useState({ enabled: false, updatedAt: null });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(getCurrentPath());
      setLocationVersion(window.location.pathname + window.location.search);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // E2EE bootstrap: ensure this browser has an ECDH keypair for the current
  // user and that the server has a fresh copy of the public key, so any
  // counterpart can derive a shared chat key. Runs on every authenticated
  // app load (covers fresh logins and page refreshes alike); idempotent.
  useEffect(() => {
    if (!isAuthenticated) return;
    const userId = getUserId();
    if (!userId) return;

    getOrCreateKeyPair(userId)
      .then(({ publicKey }) => exportPublicKeyJwk(publicKey))
      .then(registerPublicKey)
      .catch(() => {
        // Best-effort — a failed registration here just delays this user's
        // counterparts from being able to derive a chat key until retried.
      });
  }, [isAuthenticated]);

  useEffect(() => {
    let timerId = null;

    async function refreshPublicStatus() {
      try {
        // Used by global maintenance banner/screen for non-admin users.
        const response = await axios.get(`${API_BASE_URL}/api/system/public-status`);
        setMaintenanceMode(response.data?.maintenanceMode || { enabled: false, updatedAt: null });
      } catch {
        // Preserve the latest known status if the check fails.
      }
    }

    refreshPublicStatus();
    timerId = setInterval(refreshPublicStatus, 15000);

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, "", path);
    setCurrentPath(getCurrentPath());
    setLocationVersion(window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSignOut = () => {
    removeToken();
    removeUserId();
    navigate("/join");
  };

  const handleQuickExit = async () => {
    // If collapsed, first interaction expands the control instead of navigating.
    // This reduces accidental exits from incidental taps.
    if (isQuickExitCollapsed) {
      setIsQuickExitCollapsed(false);
      return;
    }

    const activeUserId = getUserId();
    if (activeUserId) {
      try {
        // Best-effort forensic minimization: remove this user's local E2EE keypair.
        await deleteKeyPair(activeUserId);
      } catch {
        // Continue quick-exit regardless of local storage cleanup outcome.
      }
    }

    removeToken();
    removeUserId();
    window.location.replace(QUICK_EXIT_URL);
  };

  useEffect(() => {
    const resetQuickExitIdleTimer = () => {
      setIsQuickExitCollapsed(false);

      if (quickExitIdleTimerRef.current) {
        window.clearTimeout(quickExitIdleTimerRef.current);
      }

      // Keep the control discreet by auto-collapsing shortly after activity settles.
      quickExitIdleTimerRef.current = window.setTimeout(() => {
        setIsQuickExitCollapsed(true);
      }, 3000);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetQuickExitIdleTimer, { passive: true });
    });

    resetQuickExitIdleTimer();

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetQuickExitIdleTimer);
      });

      if (quickExitIdleTimerRef.current) {
        window.clearTimeout(quickExitIdleTimerRef.current);
      }
    };
  }, []);

  // /reports is intentionally excluded from this set — unauthenticated users who navigate
  // there receive a purpose-built emergency intercept screen inside ReportingPage rather
  // than a silent redirect, so they can access crisis contacts without creating an account.
  const protectedPaths = new Set(["/chat", "/staff", "/callbacks", "/community", "/profile", "/moderation", "/ngo-admin"]);
  const resolvedPath = protectedPaths.has(currentPath) && !isAuthenticated ? "/join" : currentPath;
  const roleResolvedPath = (() => {
    if (resolvedPath === "/ngo-admin") {
      return "/home";
    }

    return resolvedPath;
  })();
  const activeRoutes = getRoutesForRole(role, isAuthenticated);
  const hasKnownPath = knownPaths.has(currentPath);
  const fallbackPath = isAuthenticated ? "/home" : "/";
  const finalPath = hasKnownPath ? (activeRoutes[roleResolvedPath] ? roleResolvedPath : fallbackPath) : currentPath;
  const Page = hasKnownPath ? (activeRoutes[finalPath] || LandingPage) : NotFoundPage;

  // During active maintenance, non-admin sessions are redirected to a
  // read-only status card instead of normal app pages.
  // Exception: keep /join reachable so signed-out operators can still recover
  // access by authenticating as NGO_ADMIN.
  const shouldShowMaintenanceScreen =
    maintenanceMode.enabled &&
    role !== "NGO_ADMIN" &&
    finalPath !== "/join";

  if (shouldShowMaintenanceScreen) {
    return (
      <div className="app-shell">
        {/*
          Dedicated maintenance surface for non-admin sessions.
          This keeps users informed while backend maintenance guard returns 503s.
        */}
        <main className="maintenance-page" role="main" aria-label="Maintenance status page">
          {/*
            aria-live allows periodic maintenance-status polling updates
            (reason/time changes) to be announced in assistive technologies.
          */}
          <section className="maintenance-card" aria-live="polite">
            <p className="maintenance-pill">Service Care Window</p>
            <h1>System Under Maintenance</h1>
            <p className="maintenance-lead">
              We are performing scheduled service updates to keep the platform secure, stable, and safe for everyone.
            </p>

            <div className="maintenance-meta-grid">
              {/* Operational reason set by an NGO admin while enabling maintenance. */}
              <article className="maintenance-meta-item">
                <h2>Current activity</h2>
                <p>{maintenanceMode.reason || "Scheduled platform maintenance"}</p>
              </article>
              {/* Last maintenance-state write time from backend control plane. */}
              <article className="maintenance-meta-item">
                <h2>Last status update</h2>
                <p>{maintenanceMode.updatedAt ? new Date(maintenanceMode.updatedAt).toLocaleString() : "-"}</p>
              </article>
              {/* Optional ETA authored by an NGO admin; may be intentionally absent. */}
              <article className="maintenance-meta-item">
                <h2>Estimated return</h2>
                <p>{maintenanceMode.expectedUntil ? new Date(maintenanceMode.expectedUntil).toLocaleString() : "Not specified"}</p>
              </article>
              {/* Human-readable countdown derived from expectedUntil for quick scanning. */}
              <article className="maintenance-meta-item">
                <h2>Time remaining</h2>
                <p>{maintenanceMode.expectedUntil ? formatMaintenanceCountdown(maintenanceMode.expectedUntil) : "Awaiting estimate"}</p>
              </article>
            </div>

            <div className="maintenance-actions">
              <button
                type="button"
                className="maintenance-btn maintenance-btn-secondary"
                onClick={() => window.location.reload()}
              >
                Refresh Status
              </button>
              <button
                type="button"
                className="maintenance-btn maintenance-btn-danger"
                // Escape hatch for accidental non-admin sessions during maintenance.
                // Clears current auth context and returns user to /join.
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SiteHeader
        currentPath={finalPath}
        onNavigate={navigate}
        isAuthenticated={isAuthenticated}
        role={role}
        onSignOut={handleSignOut}
      />
      <button
        type="button"
        className={`app-quick-exit ${isQuickExitCollapsed ? "collapsed" : "expanded"}`}
        onClick={handleQuickExit}
        onMouseEnter={() => setIsQuickExitCollapsed(false)}
        onFocus={() => setIsQuickExitCollapsed(false)}
        aria-label="Quick Exit"
      >
        <span className="app-quick-exit-label">Quick Exit</span>
      </button>
      <PageTransition path={finalPath}>
        <Suspense fallback={<RouteLoadingFallback />}>
          {/* Keyed by full pathname+search (not just pathname) so a notification
              deep-link that only changes the query string — e.g. /chat ->
              /chat?channel=Y while already on /chat — forces a real remount.
              Pages read deep-link query params (channel/room/reportId) only at
              mount time by design; a remount is what re-arms that logic. */}
          <Page key={locationVersion} onNavigate={navigate} role={role} onSignOut={handleSignOut} />
        </Suspense>
      </PageTransition>
    </div>
  );
}

export default App;
