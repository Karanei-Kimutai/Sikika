import SikikaLogo from "./SikikaLogo";

/**
 * AdminWorkspace
 * --------------
 * Layout shell for the NGO Admin dashboard (the only admin role — System
 * Admin was removed). Renders a two-column sidebar + content grid, a branded
 * section navigation sidebar, and a topbar identity card.
 *
 * Why this component exists:
 * - centralizes common chrome (identity card, sidebar/actions, module area)
 * - lets the dashboard focus on business logic and section rendering
 *
 * @param {object} props
 * @param {string} props.roleLabel - Short role name shown in the sidebar brand block and topbar kicker (e.g. "NGO Admin").
 * @param {string} props.title - Page heading shown in the content area topbar.
 * @param {string} props.subtitle - Subheading or context line below the title.
 * @param {Array<{ label: string, value: string }>} props.profile - Key–value pairs rendered in the identity card (e.g. phone, status).
 * @param {Array<{ id: string, label: string, description: string }>} props.menuItems - Sidebar navigation entries.
 * @param {string} props.activeSection - The `id` of the currently selected menu item.
 * @param {Function} props.onSelectSection - Called with the selected menu item's `id` when a sidebar button is clicked.
 * @param {Function} props.onNavigate - App.jsx's pushState navigator for the sidebar's Library/Community links.
 * @param {Function} props.onSignOut - Called when the Sign Out button is clicked.
 * @param {boolean} [props.showSidebar=true] - When false, hides the sidebar for compact single-column mode.
 * @param {React.ReactNode} props.children - The active section's content to render in the module area.
 * @returns {React.ReactElement}
 */
function AdminWorkspace({
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

  return (
    <main className="admin-workspace ngo">
      <div className={`admin-workspace-grid ${showSidebar ? "" : "single-column"}`}>
        {showSidebar && (
          <aside className="admin-sidebar" aria-label="Admin navigation">
            <button type="button" className="admin-brand" onClick={() => onSelectSection(menuItems[0]?.id)}>
              <SikikaLogo size={32} />
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
