import { useEffect, useRef, useState } from "react";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import LibraryPage from "./pages/LibraryPage";
import DirectChatPage from "./pages/DirectChatPage";
import ReportingPage from "./pages/ReportingPage";
import CommunityPage from "./pages/CommunityPage";
import ModerationDashboardPage from "./pages/ModerationDashboardPage";
import "./App.css";

const QUICK_EXIT_URL = "https://www.google.com";

const routes = {
  "/": LandingPage,
  "/home": LandingPage,
  "/library": LibraryPage,
  "/join": AuthPage,
  "/chat": DirectChatPage,
  "/reports": ReportingPage,
  "/community": CommunityPage,
  "/moderation": ModerationDashboardPage
};

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
  return window.location.pathname in routes ? window.location.pathname : "/";
}

function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  const [isQuickExitCollapsed, setIsQuickExitCollapsed] = useState(false);
  const quickExitIdleTimerRef = useRef(null);
  const isAuthenticated = Boolean(localStorage.getItem("authToken"));
  const role = decodeRoleFromToken();

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
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

  const protectedPaths = new Set(["/chat", "/community", "/moderation", "/reports"]);
  const resolvedPath = protectedPaths.has(currentPath) && !isAuthenticated ? "/join" : currentPath;
  const roleResolvedPath = resolvedPath === "/moderation" && role !== "NGO_ADMIN" ? "/community" : resolvedPath;
  const Page = routes[roleResolvedPath] || LandingPage;

  return (
    <div className="app-shell">
      <SiteHeader
        currentPath={roleResolvedPath}
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
      <Page onNavigate={navigate} />
    </div>
  );
}

export default App;
