import { UserCheck } from "lucide-react";
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
    <section className="banned-users-section" aria-label="Banned Users">
      <div className="banned-users-header">
        <div>
          <h3 className="admin-card-title">Banned Users Registry</h3>
          <p className="admin-card-subtitle">
            All accounts currently banned — survivors, counsellors, and legal counsel.
          </p>
        </div>
        <div className="filter-row">
          <label htmlFor="banned-role-filter" className="filter-label">Filter:</label>
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
      </div>

      {bannedUsersLoading && (
        <p className="admin-empty">Loading banned accounts…</p>
      )}

      {!bannedUsersLoading && bannedUsers.length === 0 && (
        <p className="admin-empty">No accounts are currently banned.</p>
      )}

      {!bannedUsersLoading && bannedUsers.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table banned-table">
            <thead>
              <tr>
                <th>Identifier</th>
                <th>Role</th>
                <th>Reason</th>
                <th>Banned</th>
                <th>Expires</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {bannedUsers.map((u) => (
                <tr key={u.userId}>
                  <td className="mono">{u.phoneNumber || u.userId.slice(0, 12)}</td>
                  <td>
                    <span className={`ban-role-pill ban-role-${String(u.role || "").toLowerCase()}`}>
                      {prettifyLabel(u.role)}
                    </span>
                  </td>
                  <td className="ban-reason-cell">{u.banReason || "—"}</td>
                  <td className="date-cell">{formatDate(u.bannedAt)}</td>
                  <td>
                    {u.isPermanent
                      ? <span className="pill priority-high">Permanent</span>
                      : <span className="date-cell">{formatDate(u.banExpiresAt)}</span>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={liftingBanId === u.userId}
                      onClick={() => onLiftBan(u.userId, u.phoneNumber || u.role)}
                    >
                      <UserCheck size={13} aria-hidden="true" />
                      {liftingBanId === u.userId ? "Lifting…" : "Lift Ban"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
