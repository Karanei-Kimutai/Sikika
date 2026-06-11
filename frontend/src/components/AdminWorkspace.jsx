/**
 * AdminWorkspace
 * --------------
 * Shared layout shell for both NGO and System admin pages.
 *
 * Why this component exists:
 * - keeps the two dashboards visually consistent
 * - centralizes common chrome (identity card, sidebar/actions, module area)
 * - lets each dashboard focus on business logic and section rendering
 *
 * Key props:
 * - `variant`: switches color theme between `ngo` and `system`
 * - `menuItems` + `activeSection`: section navigation metadata/state
 * - `showSidebar`: allows compact single-column mode where page-level nav is external
 */
function AdminWorkspace({
  variant,
  roleLabel,
  title,
  subtitle,
  profile,
  menuItems,
  activeSection,
  onSelectSection,
  onNavigate,
  onSignOut,
  showSidebar = true,
  children
}) {
  // Theme class drives CSS variable selection in App.css.
  const heroClass = variant === "system" ? "admin-workspace system" : "admin-workspace ngo";

  return (
    <main className={heroClass}>
      <div className={`admin-workspace-grid ${showSidebar ? "" : "single-column"}`}>
        {showSidebar && (
          <aside className="admin-sidebar" aria-label="Admin navigation">
            <button type="button" className="admin-brand" onClick={() => onSelectSection(menuItems[0]?.id)}>
              <span aria-hidden="true">GS</span>
              <div>
                <strong>Admin Control</strong>
                <small>{roleLabel}</small>
              </div>
            </button>

            <nav className="admin-menu" aria-label="Section menu">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={activeSection === item.id ? "active" : ""}
                  onClick={() => onSelectSection(item.id)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </nav>

            <div className="admin-sidebar-actions">
              <button type="button" className="admin-nav-btn" onClick={() => onNavigate("/library")}>Resource Library</button>
              <button type="button" className="admin-nav-btn" onClick={() => onNavigate("/community")}>Community Spaces</button>
              <button type="button" className="admin-nav-btn danger" onClick={onSignOut}>Sign Out</button>
            </div>
          </aside>
        )}

        <section className="admin-content-area">
          <header className="admin-topbar">
            <div>
              <p className="admin-kicker">{roleLabel}</p>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <aside className="admin-identity-card">
              <h2>Signed In Profile</h2>
              {profile.map((item) => (
                <p key={item.label}>
                  <strong>{item.label}:</strong> {item.value}
                </p>
              ))}
            </aside>
          </header>

          <div className="admin-module-space">{children}</div>
        </section>
      </div>
    </main>
  );
}

export default AdminWorkspace;
