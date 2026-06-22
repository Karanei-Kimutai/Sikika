import { useEffect, useRef, useState } from "react";
import { Trash2, UserCheck, UserX } from "lucide-react";
import { formatDate, prettifyLabel } from "./helpers";
import BannedUsersSection from "./BannedUsersSection";
import { staggerIn } from "../../utils/motion";

/**
 * ModerationDeskSection
 * ---------------------
 * Renders the Community Moderation Desk with two internal tabs:
 *   - "Reports Queue"  — flagged community-message review table (default)
 *   - "Banned Users"   — full banned-accounts registry with unban actions
 *
 * Co-locating both surfaces under a single section removes the need for a
 * separate sidebar entry for banned users, which was previously unreachable
 * because AdminWorkspace is mounted with showSidebar={false}.
 *
 * Banning from the Reports Queue passes the contentReportId to the parent's
 * handleOpenBanModal so that handleSubmitBan resolves the report atomically
 * with the ban (via reviewModerationReport).
 *
 * @param {object}    props
 * @param {Array}     props.moderationQueue           - dashboard.moderationQueue rows.
 * @param {object|null} props.selectedModerationRow   - Row whose detail dialog is open.
 * @param {Function}  props.setSelectedModerationRow  - Open/close the detail dialog.
 * @param {Function}  props.onModerationAction        - (reportId, action) → void.
 * @param {Function}  props.onOpenBanModal            - (userId, label, reportId) → void.
 * @param {Function}  props.onUnban                   - (userId, label) → void.
 * @param {Array}     props.bannedUsers               - Banned-accounts list for the registry tab.
 * @param {boolean}   props.bannedUsersLoading        - Loading state for the registry.
 * @param {string}    props.bannedUsersFilter         - Current role filter value.
 * @param {Function}  props.setBannedUsersFilter      - Update the role filter.
 * @param {string|null} props.liftingBanId            - userId currently being unbanned (for spinner).
 * @param {Function}  props.onLiftBan                 - (userId, label) → void — triggers unban.
 * @param {Function}  props.onBannedUsersTabOpen      - Called when the Banned Users tab is first
 *                                                      opened so the parent can lazy-load the list.
 */
export default function ModerationDeskSection({
  moderationQueue,
  selectedModerationRow,
  setSelectedModerationRow,
  onModerationAction,
  onOpenBanModal,
  onUnban,
  bannedUsers,
  bannedUsersLoading,
  bannedUsersFilter,
  setBannedUsersFilter,
  liftingBanId,
  onLiftBan,
  onBannedUsersTabOpen
}) {
  /**
   * activeTab controls which sub-view is rendered inside this section.
   * "reports" → community reports queue (default)
   * "banned"  → banned users registry
   */
  const [activeTab, setActiveTab] = useState("reports");
  const tableRef = useRef(null);

  // Stagger the reports-queue rows in once the list loads.
  useEffect(() => {
    if (!tableRef.current) return;
    const rows = tableRef.current.querySelectorAll('tbody tr');
    if (!rows.length) return;
    const mm = staggerIn(rows, { y: 8, stagger: 0.04 });
    return () => mm.revert();
  }, [moderationQueue]);

  /**
   * Handle tab switch. When switching to the Banned Users tab for the first
   * time, notify the parent so it can lazy-load the list without requiring a
   * full section change.
   *
   * @param {"reports"|"banned"} tab
   */
  function handleTabSwitch(tab) {
    if (tab === "banned" && activeTab !== "banned") {
      onBannedUsersTabOpen?.();
    }
    setActiveTab(tab);
  }

  return (
    <>
      {/* ── Internal tab bar ─────────────────────────────────────────────── */}
      <div className="moderation-tab-bar" role="tablist" aria-label="Moderation sub-sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "reports"}
          className={`moderation-tab-btn${activeTab === "reports" ? " active" : ""}`}
          onClick={() => handleTabSwitch("reports")}
        >
          Reports Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "banned"}
          className={`moderation-tab-btn${activeTab === "banned" ? " active" : ""}`}
          onClick={() => handleTabSwitch("banned")}
        >
          Banned Users
        </button>
      </div>

      {/* ── Reports Queue tab ────────────────────────────────────────────── */}
      {activeTab === "reports" && (
        <section className="admin-module-grid" aria-label="Moderation desk">
          <article className="admin-panel full-span">
            <h2>Community Moderation Queue</h2>
            <div className="admin-table-wrap" ref={tableRef}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Room</th>
                    <th>Message Snippet</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(moderationQueue || []).map((row) => (
                    <tr key={row.reportId}>
                      <td>{formatDate(row.submittedAt)}</td>
                      <td>{row.roomName}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setSelectedModerationRow(row)}
                        >
                          View Message + Reason
                        </button>
                      </td>
                      <td className="action-cell">
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => onModerationAction(row.reportId, "remove_message")}
                        >
                          <Trash2 size={13} aria-hidden="true" /> Delete Message
                        </button>
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => onModerationAction(row.reportId, "issue_warning")}
                        >
                          Issue Warning
                        </button>
                        {/* Ban / Lift Ban — branches on whether the author is already banned.
                            Banning from here resolves the report atomically (reportId is passed
                            to the modal so handleSubmitBan uses reviewModerationReport). */}
                        {row.senderUserId && (
                          row.senderAccountStatus === "BANNED" ? (
                            <button
                              type="button"
                              className="admin-action-btn"
                              onClick={() => onUnban(row.senderUserId, `Community Member ${row.senderUserId.slice(0, 8)}`)}
                            >
                              <UserCheck size={13} aria-hidden="true" /> Lift Ban
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="admin-action-btn danger"
                              onClick={() => onOpenBanModal(
                                row.senderUserId,
                                `Community Member ${row.senderUserId.slice(0, 8)}`,
                                row.reportId
                              )}
                            >
                              <UserX size={13} aria-hidden="true" /> Ban User
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {/* ── Banned Users tab ─────────────────────────────────────────────── */}
      {activeTab === "banned" && (
        <BannedUsersSection
          bannedUsers={bannedUsers}
          bannedUsersLoading={bannedUsersLoading}
          bannedUsersFilter={bannedUsersFilter}
          setBannedUsersFilter={setBannedUsersFilter}
          liftingBanId={liftingBanId}
          onLiftBan={onLiftBan}
        />
      )}

      {/* ── Moderation detail dialog (mounted here, visible on top of table) ── */}
      {selectedModerationRow && (
        <div
          className="admin-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="moderation-reason-title"
          onClick={() => setSelectedModerationRow(null)}
        >
          <article
            className="admin-confirm-modal report-details-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="moderation-reason-title">Moderation Report Details</h3>
            <div className="moderation-detail-grid">
              <p><strong>Room:</strong> {selectedModerationRow.roomName}</p>
              <p><strong>Reported by:</strong> {selectedModerationRow.reporterLabel || "Community Member"}</p>
              <p><strong>Submitted:</strong> {formatDate(selectedModerationRow.submittedAt)}</p>
              <p><strong>Status:</strong> {prettifyLabel(selectedModerationRow.status)}</p>
            </div>
            <section className="moderation-detail-card">
              <h4>Message</h4>
              <p>{selectedModerationRow.snippet || "No message content available."}</p>
            </section>
            <section className="moderation-detail-card">
              <h4>Reported Reason</h4>
              <p>{selectedModerationRow.reportReasonText || "No reason provided."}</p>
            </section>
            <div className="admin-confirm-actions">
              <button type="button" className="secondary-btn" onClick={() => setSelectedModerationRow(null)}>
                Close
              </button>
            </div>
          </article>
        </div>
      )}
    </>
  );
}
