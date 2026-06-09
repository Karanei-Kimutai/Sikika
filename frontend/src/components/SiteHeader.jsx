/**
 * Shared public navigation header.
 *
 * The header receives navigation as a prop so App.jsx remains the only place
 * that mutates browser history.
 */
function SiteHeader({ currentPath, onNavigate }) {
  const navItems = [
    { path: "/", label: "Home" },
    { path: "/library", label: "Library" }
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

      <button type="button" className="header-action" onClick={() => onNavigate("/join")}>
        Join Community
      </button>
    </header>
  );
}

export default SiteHeader;
