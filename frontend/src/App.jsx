import { useEffect, useState } from "react";
import SiteHeader from "./components/SiteHeader";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import LibraryPage from "./pages/LibraryPage";
import "./App.css";

/**
 * Root application shell.
 *
 * Responsibilities:
 * - Keep a lightweight client-side route state for public pages.
 * - Render the shared header across landing, library, and auth screens.
 * - Preserve direct URL access for the core routes without adding a router package.
 */
const routes = {
  "/": LandingPage,
  "/home": LandingPage,
  "/library": LibraryPage,
  "/join": AuthPage
};

// Unknown paths fall back to the public landing page.
function getCurrentPath() {
  return window.location.pathname in routes ? window.location.pathname : "/";
}

function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);

  useEffect(() => {
    // Keep page state in sync when users navigate with browser back/forward.
    const handlePopState = () => setCurrentPath(getCurrentPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, "", path);
    setCurrentPath(getCurrentPath());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const Page = routes[currentPath] || LandingPage;

  return (
    <div className="app-shell">
      <SiteHeader currentPath={currentPath} onNavigate={navigate} />
      <Page onNavigate={navigate} />
    </div>
  );
}

export default App;
