import { formatDate, prettifyLabel } from "./helpers";

/**
 * BannedUsersSection
 * ------------------
 * Displays the Banned Users Registry tab of the NGO dashboard.
 * Renders the role-filter dropdown, the banned-accounts table, and
 * per-row Lift Ban controls.
 *
 * @param {object} props
 * @param {Array}    props.bannedUsers         - List of banned user objects from the backend.
 * @param {boolean}  props.bannedUsersLoading  - True while the list is being fetched.
 * @param {string}   props.bannedUsersFilter   - Current role filter value ("" = all roles).
 * @param {Function} props.setBannedUsersFilter - Setter for the role filter.
 * @param {string|null} props.liftingBanId     - userId of the ban currently being lifted (drives loading state).
 * @param {Function} props.onLiftBan           - (userId, label) → void; calls the parent unban handler.
 */
export default function BannedUsersSection({
  bannedUsers,
  bannedUsersLoading,
  bannedUsersFilter,
  setBannedUsersFilter,
  liftingBanId,
  onLiftBan
}) {
  return (
    <section className="dashboard-section" aria-label="Banned Users">
      <article className="admin-card">
        <h3 className="admin-card-title">Banned Users Registry</h3>
        <p className="admin-card-subtitle">
          All accounts currently banned — survivors, counsellors, and legal counsel.
          Use Lift Ban to restore ACTIVE status.
        </p>

        <div className="filter-row" style={{ marginBottom: "1rem" }}>
          <label htmlFor="banned-role-filter" className="filter-label">Filter by role:</label>
          <select
            id="banned-role-filter"
            className="filter-select"
            value={bannedUsersFilter}
            onChange={(e) => setBannedUsersFilter(e.target.value)}
          >
            <option value="">All roles</option>
            <option value="SURVIVOR">Survivor</option>
            <option value="COUNSELLOR">Counsellor</option>
            <option value="LEGAL_COUNSEL">Legal Counsel</option>
          </select>
        </div>

        {bannedUsersLoading && <p className="admin-empty">Loading banned accounts…</p>}

        {!bannedUsersLoading && bannedUsers.length === 0 && (
          <p className="admin-empty">No accounts are currently banned.</p>
        )}

        {!bannedUsersLoading && bannedUsers.length > 0 && (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Reason</th>
                  <th>Banned At</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bannedUsers.map((u) => (
                  <tr key={u.userId}>
                    <td className="mono">{u.phoneNumber || u.userId}</td>
                    <td>
                      <span className="pill pill-neutral">{prettifyLabel(u.role)}</span>
                    </td>
                    <td style={{ maxWidth: "260px", wordBreak: "break-word" }}>
                      {u.banReason || "-"}
                    </td>
                    <td>{formatDate(u.bannedAt)}</td>
                    <td>
                      {u.isPermanent
                        ? <span className="pill priority-high">Permanent</span>
                        : formatDate(u.banExpiresAt)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm btn-secondary"
                        disabled={liftingBanId === u.userId}
                        onClick={() => onLiftBan(u.userId, u.phoneNumber || u.role)}
                      >
                        {liftingBanId === u.userId ? "Lifting…" : "Lift Ban"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
