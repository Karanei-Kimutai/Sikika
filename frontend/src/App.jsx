import { useEffect, useRef, useState } from "react";
import axios from "axios";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import LibraryPage from "./pages/LibraryPage";
import DirectChatPage from "./pages/DirectChatPage";
import ReportingPage from "./pages/ReportingPage";
import CommunityPage from "./pages/CommunityPage";
import ModerationDashboardPage from "./pages/ModerationDashboardPage";
import NgoAdminDashboardPage from "./pages/NgoAdminDashboardPage";
import SystemAdminDashboardPage from "./pages/SystemAdminDashboardPage";
import ManageProfilePage from "./pages/ManageProfilePage";
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

// Public route map for unauthenticated users and fallback routing.
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
  "/system-admin": SystemAdminDashboardPage
};

const knownPaths = new Set(Object.keys(publicRoutes));

// Role-specific route remapping used after successful authentication.
const ngoAdminRoutes = {
  "/": (props) => <NgoAdminDashboardPage {...props} initialSection="command-center" />,
  "/home": (props) => <NgoAdminDashboardPage {...props} initialSection="command-center" />,
  "/reports": (props) => <NgoAdminDashboardPage {...props} initialSection="reports" />,
  "/chat": (props) => <NgoAdminDashboardPage {...props} initialSection="team-capacity" />,
  "/community": CommunityPage,
  "/moderation": (props) => <NgoAdminDashboardPage {...props} initialSection="moderation-desk" />,
  "/library": LibraryPage,
  "/profile": ManageProfilePage,
  "/join": AuthPage
};

const systemAdminRoutes = {
  "/": (props) => <SystemAdminDashboardPage {...props} initialSection="infrastructure" />,
  "/home": (props) => <SystemAdminDashboardPage {...props} initialSection="infrastructure" />,
  "/chat": (props) => <SystemAdminDashboardPage {...props} initialSection="maintenance" />,
  "/community": (props) => <SystemAdminDashboardPage {...props} initialSection="ops-logs" />,
  "/library": (props) => <SystemAdminDashboardPage {...props} initialSection="admin-access" />,
  "/profile": ManageProfilePage,
  "/join": AuthPage
};

function getRoutesForRole(role, isAuthenticated) {
  if (!isAuthenticated) return publicRoutes;
  if (role === "NGO_ADMIN") return ngoAdminRoutes;
  if (role === "SYSTEM_ADMIN") return systemAdminRoutes;
  return publicRoutes;
}

// UI-only route gating helper; API authorization still happens on the backend.
function decodeRoleFromToken() {
  const token = localStorage.getItem("authToken");
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
  const isAuthenticated = Boolean(localStorage.getItem("authToken"));
  const role = decodeRoleFromToken();
  const [maintenanceMode, setMaintenanceMode] = useState({ enabled: false, updatedAt: null });

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let timerId = null;

    async function refreshPublicStatus() {
      try {
        // Used by global maintenance banner/screen for non-system-admin users.
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
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
    navigate("/join");
  };

  const handleQuickExit = () => {
    // If collapsed, first interaction expands the control instead of navigating.
    // This reduces accidental exits from incidental taps.
    if (isQuickExitCollapsed) {
      setIsQuickExitCollapsed(false);
      return;
    }

    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
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

  const protectedPaths = new Set(["/chat", "/community", "/profile", "/moderation", "/reports", "/ngo-admin", "/system-admin"]);
  const resolvedPath = protectedPaths.has(currentPath) && !isAuthenticated ? "/join" : currentPath;
  const roleResolvedPath = (() => {
    if (["/ngo-admin", "/system-admin"].includes(resolvedPath)) {
      return "/home";
    }

    return resolvedPath;
  })();
  const activeRoutes = getRoutesForRole(role, isAuthenticated);
  const fallbackPath = isAuthenticated ? "/home" : "/";
  const finalPath = activeRoutes[roleResolvedPath] ? roleResolvedPath : fallbackPath;
  const Page = activeRoutes[finalPath] || LandingPage;

  // During active maintenance, only system admins keep normal UI access.
  const shouldShowMaintenanceScreen = maintenanceMode.enabled && role !== "SYSTEM_ADMIN";

  if (shouldShowMaintenanceScreen) {
    return (
      <div className="app-shell">
        <main className="admin-page system-admin-theme">
          <section className="admin-shell">
            <article className="admin-panel full-span">
              <h1>System Under Maintenance</h1>
              <p>
                Core services are temporarily unavailable while administrators perform platform updates.
                Please check back shortly.
              </p>
              <p>
                Reason: {maintenanceMode.reason || "Scheduled platform maintenance"}
              </p>
              <p>
                Last update: {maintenanceMode.updatedAt ? new Date(maintenanceMode.updatedAt).toLocaleString() : "-"}
              </p>
              <p>
                Expected back: {maintenanceMode.expectedUntil ? new Date(maintenanceMode.expectedUntil).toLocaleString() : "Not specified"}
              </p>
              {maintenanceMode.expectedUntil && (
                <p>
                  Countdown: {formatMaintenanceCountdown(maintenanceMode.expectedUntil)}
                </p>
              )}
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => window.location.reload()}
              >
                Refresh Status
              </button>
            </article>
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
