/**
 * SiteHeader
 * ----------
 * Shared top navigation for public, survivor/staff, and admin sessions.
 *
 * Important behavior:
 * - primary nav tabs are role-aware
 * - admins do not use quick action buttons; they navigate via section tabs/routes
 * - sign-out is always available for authenticated sessions
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
        { path: "/library", label: "Resources" }
      ];
    }

    if (role === "SYSTEM_ADMIN") {
      return [
        { path: "/home", label: "Home" },
        { path: "/community", label: "Infra Logs" },
        { path: "/chat", label: "Maintenance" },
        { path: "/library", label: "Access Control" }
      ];
    }

    return [
      { path: "/", label: "Home" },
      { path: "/library", label: "Library" },
      { path: "/reports", label: "Reports" },
      { path: "/chat", label: "Direct Chat" },
      { path: "/community", label: "Community" }
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
        {navItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className={currentPath === item.path || (item.path === "/" && currentPath === "/home") ? "active" : ""}
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        {!isAuthenticated && (
          <button type="button" className="header-action" onClick={() => onNavigate("/join")}>
            Join Community
          </button>
        )}
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
