/**
 * Shared public navigation header.
 *
 * The header receives navigation as a prop so App.jsx remains the only place
 * that mutates browser history.
 */
function SiteHeader({ currentPath, isAuthenticated, onNavigate, onSignOut }) {
  const navItems = [
    { path: "/", label: "Home" },
    { path: "/library", label: "Library" },
    ...(isAuthenticated ? [{ path: "/reports", label: "Reports" }] : [])
  ];

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
        <button type="button" className="header-action" onClick={() => onNavigate(isAuthenticated ? "/reports" : "/join")}>
          {isAuthenticated ? "My Reports" : "Join Community"}
        </button>
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
