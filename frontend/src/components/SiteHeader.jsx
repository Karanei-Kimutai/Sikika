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
 */
function SiteHeader({ currentPath, onNavigate, isAuthenticated, role, onSignOut }) {
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

  return (
    <header className="site-header">
      <button type="button" className="brand-mark" onClick={() => onNavigate("/")}>
        <span className="brand-symbol" aria-hidden="true">G</span>
        <span>
          <strong>GBV Support Platform</strong>
          <small>Private help, clear resources</small>
        </span>
      </button>

      <nav className="site-nav" aria-label="Primary navigation">
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
                onNavigate(item.path);
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
          <button type="button" className="header-signout" onClick={onSignOut}>
            Sign Out
          </button>
        )}
      </div>
    </header>
  );
}

export default SiteHeader;
