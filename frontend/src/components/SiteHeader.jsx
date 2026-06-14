import { useState, useEffect, useRef } from "react";
import { LogOut, Menu, X } from "lucide-react";
import NotificationBell from "./NotificationBell";

/**
 * SiteHeader
 * ----------
 * Shared top navigation for public, survivor/staff, and admin sessions.
 *
 * Important behavior:
 * - primary nav tabs are role-aware
 * - admins do not use quick action buttons; they navigate via section tabs/routes
 * - sign-out is always available for authenticated sessions
 * - notification bell is shown for all authenticated users; polling and
 *   panel state are encapsulated inside NotificationBell
 * - hamburger drawer activates on narrow viewports (≤ 680px)
 */
function SiteHeader({ currentPath, onNavigate, isAuthenticated, role, onSignOut }) {
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef(null);
  const toggleRef = useRef(null);

  const navItems = (() => {
    if (!isAuthenticated) {
      return [
        { path: "/", label: "Home" },
        { path: "/library", label: "Library" }
      ];
    }

    if (role === "NGO_ADMIN") {
      return [
        { path: "/home", label: "Home" },
        { path: "/reports", label: "Case Queue" },
        { path: "/moderation", label: "Moderation Desk" },
        { path: "/community", label: "Community Chat" },
        { path: "/chat", label: "Staffing" },
        { path: "/profile", label: "Profile" },
        { path: "/library", label: "Resources" }
      ];
    }

    if (role === "SYSTEM_ADMIN") {
      return [
        { path: "/home", label: "Home" },
        // Report tab is read-oriented for system admins; mutation permissions
        // are still restricted in backend report status endpoints.
        { path: "/reports", label: "Reports" },
        { path: "/community", label: "Infra Logs" },
        { path: "/chat", label: "Maintenance" },
        { path: "/profile", label: "Profile" },
        { path: "/library", label: "Access Control" }
      ];
    }

    return [
      { path: "/", label: "Home" },
      { path: "/library", label: "Library" },
      { path: "/reports", label: "Reports" },
      { path: "/chat", label: "Direct Chat" },
      { path: "/community", label: "Community" },
      { path: "/profile", label: "Profile" }
    ];
  })();

  /** Close drawer on click outside nav or toggle button */
  useEffect(() => {
    if (!navOpen) return;

    const handleOutsideClick = (e) => {
      if (
        navRef.current && !navRef.current.contains(e.target) &&
        toggleRef.current && !toggleRef.current.contains(e.target)
      ) {
        setNavOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [navOpen]);

  /** Close drawer on Escape key */
  useEffect(() => {
    if (!navOpen) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navOpen]);

  const handleNavClick = (path) => {
    setNavOpen(false);
    onNavigate(path);
  };

  return (
    <header className="site-header">
      <button type="button" className="brand-mark" onClick={() => onNavigate("/")}>
        <span className="brand-symbol" aria-hidden="true">G</span>
        <span>
          <strong>GBV Support Platform</strong>
          <small>Private help, clear resources</small>
        </span>
      </button>

      <button
        ref={toggleRef}
        type="button"
        className="site-nav-toggle"
        aria-expanded={navOpen}
        aria-controls="primary-nav"
        aria-label="Toggle navigation"
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>

      <nav
        ref={navRef}
        id="primary-nav"
        className={`site-nav${navOpen ? " site-nav--open" : ""}`}
        aria-label="Primary navigation"
      >
        {navItems.map((item) => {
          const isActive = currentPath === item.path || (item.path === "/" && currentPath === "/home");
          return (
            <a
              key={item.path}
              href={item.path}
              className={`site-nav-link ${isActive ? "active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                handleNavClick(item.path);
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="header-actions">
        {!isAuthenticated && (
          <button type="button" className="header-action" onClick={() => onNavigate("/join")}>
            Join Community
          </button>
        )}
        {/* Notification bell — shown for all authenticated roles.
            Encapsulates its own polling and panel state. */}
        <NotificationBell isAuthenticated={isAuthenticated} />
        {isAuthenticated && (
          <button type="button" className="header-signout" onClick={onSignOut} aria-label="Sign out">
            <LogOut size={16} aria-hidden="true" />
            <span className="header-signout-label">Sign Out</span>
          </button>
        )}
      </div>
    </header>
  );
}

export default SiteHeader;
