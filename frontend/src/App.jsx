import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { getToken, getUserId, removeToken, removeUserId } from "./utils/auth";
import { getOrCreateKeyPair } from "./utils/keyStorage";
import { exportPublicKeyJwk } from "./utils/cryptoUtils";
import { registerPublicKey } from "./services/chatKeys";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import LibraryPage from "./pages/LibraryPage";
import DirectChatPage from "./pages/DirectChatPage";
import ReportingPage from "./pages/ReportingPage";
import CommunityPage from "./pages/CommunityPage";
import ModerationDashboardPage from "./pages/ModerationDashboardPage";
import NgoAdminDashboardPage from "./pages/NgoAdminDashboardPage";
import ManageProfilePage from "./pages/ManageProfilePage";
import MyCallbacksPage from "./pages/MyCallbacksPage";
import "./App.css";

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
  return knownPaths.has(window.location.pathname) ? window.location.pathname : "/";
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

function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  const [isQuickExitCollapsed, setIsQuickExitCollapsed] = useState(false);
  const quickExitIdleTimerRef = useRef(null);
  const isAuthenticated = Boolean(getToken());
  const role = decodeRoleFromToken();
  const [maintenanceMode, setMaintenanceMode] = useState({ enabled: false, updatedAt: null });

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSignOut = () => {
    removeToken();
    removeUserId();
    navigate("/join");
  };

  const handleQuickExit = () => {
    // If collapsed, first interaction expands the control instead of navigating.
    // This reduces accidental exits from incidental taps.
    if (isQuickExitCollapsed) {
      setIsQuickExitCollapsed(false);
      return;
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
  const fallbackPath = isAuthenticated ? "/home" : "/";
  const finalPath = activeRoutes[roleResolvedPath] ? roleResolvedPath : fallbackPath;
  const Page = activeRoutes[finalPath] || LandingPage;

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
      <Page onNavigate={navigate} role={role} onSignOut={handleSignOut} />
    </div>
  );
}

export default App;
