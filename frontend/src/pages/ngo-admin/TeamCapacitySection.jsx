import { UserCheck, UserX } from "lucide-react";
import { formatNumber, formatDate, prettifyLabel, availabilityClass } from "./helpers";

/**
 * TeamCapacitySection
 * -------------------
 * Renders the Team Capacity tab of the NGO dashboard. Contains four panels:
 * 1. Capacity snapshot (pulse cards)
 * 2. Workload distribution bars
 * 3. Staff directory with ban/active controls
 * 4. Create staff account form
 * 5. Manual survivor reassignment form
 * 6. Survivor reassignment requests table
 *
 * All state and async handlers live in the parent (NgoAdminDashboardPage).
 * This component is purely presentational with controlled props.
 *
 * @param {object}   props
 * @param {object}   props.dashboard              - The full dashboard object (slices used: staffDirectory, staffWorkload, survivorAssignments).
 * @param {object}   props.teamStats              - Pre-computed { totalStaff, availableStaff, highLoadStaff, partiallyUnassignedSurvivors }.
 * @param {Map}      props.staffLabelById         - Map of staffId → display label.
 * @param {object}   props.assignmentForm         - Controlled reassignment form state.
 * @param {Function} props.setAssignmentForm      - Setter for assignmentForm.
 * @param {object|null} props.selectedSurvivor    - Survivor object matching assignmentForm.survivorId.
 * @param {object}   props.staffForm              - Controlled staff onboarding form state.
 * @param {Function} props.setStaffForm           - Setter for staffForm.
 * @param {string|null} props.togglingStaffId     - userId of the staff whose status is toggling.
 * @param {Array}    props.reassignmentRequests   - List of reassignment request objects.
 * @param {string}   props.reassignmentFilter     - Current status filter for requests.
 * @param {Function} props.setReassignmentFilter  - Setter for reassignmentFilter.
 * @param {string}   props.reviewingRequestId     - requestId of the request being reviewed.
 * @param {Function} props.onToggleActive         - (userId, nextStatus, label) → void.
 * @param {Function} props.onReassign             - (event) → void (form submit handler).
 * @param {Function} props.onStaffCreate          - (event) → void (form submit handler).
 * @param {Function} props.onOpenBanModal         - (userId, label) → void.
 * @param {Function} props.onUnban                - (userId, label) → void.
 * @param {Function} props.onReviewRequest        - (requestId, status) → void.
 */
export default function TeamCapacitySection({
  dashboard,
  teamStats,
  staffLabelById,
  assignmentForm,
  setAssignmentForm,
  selectedSurvivor,
  staffForm,
  setStaffForm,
  togglingStaffId,
  reassignmentRequests,
  reassignmentFilter,
  setReassignmentFilter,
  reviewingRequestId,
  onToggleActive,
  onReassign,
  onStaffCreate,
  onOpenBanModal,
  onUnban,
  onReviewRequest
}) {
  return (
    <section className="admin-module-grid" aria-label="Team capacity">
      {/* ── Capacity snapshot ──────────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Team Capacity Snapshot</h2>
        <p className="admin-note">Monitor staffing pressure before onboarding or reassignment actions.</p>
        <div className="pulse-grid">
          <div className="pulse-card">
            <span>Total support staff</span>
            <strong>{formatNumber(teamStats.totalStaff)}</strong>
          </div>
          <div className="pulse-card">
            <span>Available now</span>
            <strong>{formatNumber(teamStats.availableStaff)}</strong>
          </div>
          <div className="pulse-card">
            <span>High workload (6+ cases)</span>
            <strong>{formatNumber(teamStats.highLoadStaff)}</strong>
          </div>
          <div className="pulse-card">
            <span>Partially unassigned survivors</span>
            <strong>{formatNumber(teamStats.partiallyUnassignedSurvivors)}</strong>
          </div>
        </div>
      </article>

      {/* ── Workload distribution ──────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Workload Distribution</h2>
        <div className="stacked-bars">
          {[...(dashboard.staffWorkload?.counsellors || []), ...(dashboard.staffWorkload?.legalCounsel || [])]
            .slice(0, 12)
            .map((staff) => (
              <div key={staff.id} className="workload-row">
                <span>{staff.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.min(100, Number(staff.activeCases || 0) * 12)}%` }} />
                </div>
                <strong>{staff.activeCases}</strong>
              </div>
            ))}
        </div>
        {(!dashboard.staffWorkload?.counsellors?.length && !dashboard.staffWorkload?.legalCounsel?.length)
          ? <p className="admin-empty">No staff workload data available yet.</p>
          : <p className="admin-empty">Bars represent active assigned survivors per staff member.</p>}
      </article>

      {/* ── Staff directory ────────────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Staff Directory</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Role</th>
                <th>Specialization</th>
                <th>Active Cases</th>
                <th>Availability</th>
                <th>Account Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard.staffDirectory || []).map((staff) => {
                const status = staff.accountStatus || "ACTIVE";
                const isBanned = status === "BANNED";
                const isSuspended = status === "SUSPENDED";
                const isActive = status === "ACTIVE";
                const isToggling = togglingStaffId === staff.userId;

                // Display SUSPENDED as "Inactive" so the staffing context reads
                // naturally — this is an operational pause, not a punitive ban.
                const statusLabel = isSuspended
                  ? "Inactive"
                  : status.charAt(0) + status.slice(1).toLowerCase();

                return (
                  <tr key={`${staff.type}-${staff.id}`}>
                    <td>{staff.label}</td>
                    <td>{staff.type === "COUNSELLOR" ? "Counsellor" : "Legal Counsel"}</td>
                    <td>{staff.specialization}</td>
                    <td>{formatNumber(staff.activeCases)}</td>
                    <td>
                      <span className={availabilityClass(staff.availability)}>
                        {prettifyLabel(staff.availability)}
                      </span>
                    </td>
                    <td>
                      {/* Badge uses CSS class for colour; label maps SUSPENDED → "Inactive" */}
                      <span className={`account-status-badge account-status-badge--${status.toLowerCase()}`}>
                        {statusLabel}
                      </span>
                      {isBanned && (
                        <div className="ban-info">
                          {staff.banReason && <p><strong>Reason:</strong> {staff.banReason}</p>}
                          {staff.banExpiresAt
                            ? <p><strong>Expires:</strong> {formatDate(staff.banExpiresAt)}</p>
                            : <p>Permanent ban</p>}
                        </div>
                      )}
                    </td>
                    <td className="action-cell">
                      {isBanned ? (
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => onUnban(staff.userId, staff.label)}
                        >
                          <UserCheck size={13} aria-hidden="true" /> Lift Ban
                        </button>
                      ) : staff.userId && status !== "DEACTIVATED" && (
                        <>
                          {isActive && (
                            <button
                              type="button"
                              className="admin-action-btn"
                              disabled={isToggling}
                              onClick={() => onToggleActive(staff.userId, "SUSPENDED", staff.label)}
                            >
                              {isToggling ? "Updating…" : "Set Inactive"}
                            </button>
                          )}
                          {isSuspended && (
                            <button
                              type="button"
                              className="admin-action-btn"
                              disabled={isToggling}
                              onClick={() => onToggleActive(staff.userId, "ACTIVE", staff.label)}
                            >
                              {isToggling ? "Updating…" : "Set Active"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-action-btn danger"
                            onClick={() => onOpenBanModal(staff.userId, staff.label)}
                          >
                            <UserX size={13} aria-hidden="true" /> Ban Account
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(dashboard.staffDirectory || []).length === 0 && (
          <p className="admin-empty" style={{ marginTop: "0.8rem" }}>No staff profiles available yet.</p>
        )}
      </article>

      {/* ── Create staff account ───────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Create Staff Account</h2>
        <p className="admin-empty">
          This panel reflects the branch governance change: NGO admins now own
          counsellor/legal-counsel onboarding, while system admins focus on infrastructure.
        </p>
        <p className="admin-empty">NGO admins can onboard counsellors and legal counsel. New staff must change the temporary password on first login.</p>
        <form className="reassignment-form" onSubmit={onStaffCreate}>
          <label>
            Phone Number
            <input
              type="text"
              value={staffForm.phoneNumber}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
              placeholder="+2547XXXXXXXX"
            />
          </label>
          <label>
            Temporary Password
            <input
              type="password"
              value={staffForm.password}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="At least 6 characters"
            />
          </label>
          <label>
            Staff Role
            <select
              value={staffForm.role}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, role: event.target.value }))}
            >
              <option value="COUNSELLOR">Counsellor</option>
              <option value="LEGAL_COUNSEL">Legal Counsel</option>
            </select>
          </label>
          <label>
            Specialization
            <input
              type="text"
              value={staffForm.specialization}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, specialization: event.target.value }))}
              placeholder={staffForm.role === "COUNSELLOR" ? "Trauma support" : "Family law"}
            />
          </label>
          <label>
            Availability
            <select
              value={staffForm.availabilityStatus}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, availabilityStatus: event.target.value }))}
            >
              <option value="AVAILABLE">Available</option>
              <option value="BUSY">Busy</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </label>
          <button type="submit" className="admin-action-btn">Create Staff</button>
        </form>
      </article>

      {/* ── Manual survivor reassignment ───────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Manual Survivor Reassignment</h2>
        <p className="admin-empty">Use this form when a survivor requests a change or staff workload becomes high.</p>
        <div className="selection-summary-card">
          <h3>Current Selection</h3>
          <p><strong>Survivor:</strong> {selectedSurvivor ? `${selectedSurvivor.nickname} (${selectedSurvivor.county || "Unknown"})` : "Not selected"}</p>
          <p><strong>Counsellor:</strong> {assignmentForm.counsellorId ? (staffLabelById.get(assignmentForm.counsellorId) || assignmentForm.counsellorId) : "No change"}</p>
          <p><strong>Legal Counsel:</strong> {assignmentForm.legalCounselId ? (staffLabelById.get(assignmentForm.legalCounselId) || assignmentForm.legalCounselId) : "No change"}</p>
        </div>
        <form className="reassignment-form" onSubmit={onReassign}>
          <label>
            Survivor
            <select
              className={assignmentForm.survivorId ? "selected-value" : ""}
              value={assignmentForm.survivorId}
              onChange={(event) => setAssignmentForm((prev) => ({ ...prev, survivorId: event.target.value }))}
            >
              <option value="">Select survivor</option>
              {(dashboard.survivorAssignments || []).map((survivor) => (
                <option key={survivor.survivorId} value={survivor.survivorId}>
                  {survivor.nickname} ({survivor.county || "Unknown county"})
                </option>
              ))}
            </select>
          </label>
          <label>
            New Counsellor
            <select
              className={assignmentForm.counsellorId ? "selected-value" : ""}
              value={assignmentForm.counsellorId}
              onChange={(event) => setAssignmentForm((prev) => ({ ...prev, counsellorId: event.target.value }))}
            >
              <option value="">No change</option>
              {(dashboard.staffWorkload?.counsellors || []).map((staff) => (
                <option key={staff.id} value={staff.id}>{staff.label}</option>
              ))}
            </select>
          </label>
          <label>
            New Legal Counsel
            <select
              className={assignmentForm.legalCounselId ? "selected-value" : ""}
              value={assignmentForm.legalCounselId}
              onChange={(event) => setAssignmentForm((prev) => ({ ...prev, legalCounselId: event.target.value }))}
            >
              <option value="">No change</option>
              {(dashboard.staffWorkload?.legalCounsel || []).map((staff) => (
                <option key={staff.id} value={staff.id}>{staff.label}</option>
              ))}
            </select>
          </label>
          <label className="full-span">
            Reassignment Reason
            <input
              type="text"
              placeholder="Example: survivor requested counsellor change due to schedule mismatch"
              value={assignmentForm.reason}
              onChange={(event) => setAssignmentForm((prev) => ({ ...prev, reason: event.target.value }))}
            />
          </label>
          <button type="submit" className="admin-action-btn">Apply Reassignment</button>
        </form>
      </article>

      {/* ── Survivor reassignment requests ─────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Survivor Reassignment Requests</h2>
        <div className="report-filter-row" style={{ marginBottom: "0.9rem" }}>
          <select
            value={reassignmentFilter}
            onChange={(event) => setReassignmentFilter(event.target.value)}
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ALL">All statuses</option>
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Survivor</th>
                <th>Scope</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reassignmentRequests.map((request) => (
                <tr key={request.requestId}>
                  <td>{formatDate(request.requestTimestamp)}</td>
                  <td>{request.survivor?.displayNickname || request.survivorId}</td>
                  <td>{prettifyLabel(request.requestedScope)}</td>
                  <td>{request.requestReasonText}</td>
                  <td>{prettifyLabel(request.requestStatus)}</td>
                  <td>
                    {request.requestStatus === "PENDING" ? (
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="admin-action-btn"
                          disabled={reviewingRequestId === request.requestId}
                          onClick={() => onReviewRequest(request.requestId, "APPROVED")}
                        >
                          {reviewingRequestId === request.requestId ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={reviewingRequestId === request.requestId}
                          onClick={() => onReviewRequest(request.requestId, "REJECTED")}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reassignmentRequests.length === 0 && (
          <p className="admin-empty" style={{ marginTop: "0.8rem" }}>
            No reassignment requests found for this filter.
          </p>
        )}
      </article>
    </section>
  );
}
