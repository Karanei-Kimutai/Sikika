import { useEffect, useState } from "react";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import LibraryPage from "./pages/LibraryPage";
import DirectChatPage from "./pages/DirectChatPage";
import ReportingPage from "./pages/ReportingPage";
import CommunityPage from "./pages/CommunityPage";
import ModerationDashboardPage from "./pages/ModerationDashboardPage";
import "./App.css";

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
      <Page onNavigate={navigate} />
    </div>
  );
}

export default App;
