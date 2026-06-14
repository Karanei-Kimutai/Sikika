import { Trash2, UserCheck, UserX } from "lucide-react";
import { formatDate, prettifyLabel } from "./helpers";

/**
 * ModerationDeskSection
 * ---------------------
 * Renders the Community Moderation Queue table and the detail dialog.
 *
 * Banning from here passes the contentReportId to the parent's
 * handleOpenBanModal so that handleSubmitBan resolves the report
 * atomically with the ban (via reviewModerationReport).
 *
 * @param {object}    props
 * @param {Array}     props.moderationQueue           - dashboard.moderationQueue rows.
 * @param {object|null} props.selectedModerationRow   - Row whose detail dialog is open.
 * @param {Function}  props.setSelectedModerationRow  - Open/close the detail dialog.
 * @param {Function}  props.onModerationAction        - (reportId, action) → void.
 * @param {Function}  props.onOpenBanModal            - (userId, label, reportId) → void.
 * @param {Function}  props.onUnban                   - (userId, label) → void.
 */
export default function ModerationDeskSection({
  moderationQueue,
  selectedModerationRow,
  setSelectedModerationRow,
  onModerationAction,
  onOpenBanModal,
  onUnban
}) {
  return (
    <>
      <section className="admin-module-grid" aria-label="Moderation desk">
        <article className="admin-panel full-span">
          <h2>Community Moderation Queue</h2>
          <div className="admin-table-wrap">
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
