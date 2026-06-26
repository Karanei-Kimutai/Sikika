import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { getToken } from "../utils/auth";
import { staggerIn } from "../utils/motion";

/**
 * ModerationDashboardPage
 * -----------------------
 * Two-tab queue for reviewing harmful-content reports.
 *
 * "Pending Queue" tab — PENDING reports only, with action buttons.
 * "Review History" tab — APPROVED/REJECTED reports; click a row to see details.
 *
 * Design notes:
 * - uses REST for initial list + mutation actions
 * - subscribes to moderation socket feed for near-real-time refreshes
 * - backend returns all records; tab split is client-side
 * - backend remains source-of-truth for moderation permissions
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const moderationSocket = io(API_BASE_URL, { autoConnect: false });

function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Maps the stored reviewedAction value to a display label.
 * Falls back gracefully for legacy records that pre-date the field.
 * @param {object} report - hydrated HarmfulContentReport
 * @returns {string}
 */
function resolveOutcomeLabel(report) {
  const actionMap = {
    remove_message: "Message removed",
    ban_user:       "User banned",
    issue_warning:  "Warning issued",
    none:           "Report dismissed",
  };
  if (report.reviewedAction && actionMap[report.reviewedAction]) {
    return actionMap[report.reviewedAction];
  }
  return report.moderationReviewStatus === "APPROVED" ? "Action taken" : "Report dismissed";
}

function ModerationDashboardPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedHistoryReport, setSelectedHistoryReport] = useState(null);
  const gridRef = useRef(null);
  const historyBodyRef = useRef(null);

  // Derive pending and reviewed sub-lists from the full report set.
  const pendingReports = reports.filter(r => r.moderationReviewStatus === "PENDING");
  const reviewedReports = reports.filter(r => r.moderationReviewStatus !== "PENDING");

  // Stagger-reveal pending cards whenever the tab or data changes.
  useEffect(() => {
    if (activeTab !== "pending" || !gridRef.current) return;
    const cards = gridRef.current.querySelectorAll(".moderation-card");
    if (!cards.length) return;
    const mm = staggerIn(cards, { y: 10, stagger: 0.05 });
    return () => mm.revert();
  }, [reports, activeTab]);

  // Stagger-reveal history rows whenever the tab or data changes.
  useEffect(() => {
    if (activeTab !== "history" || !historyBodyRef.current) return;
    const rows = historyBodyRef.current.querySelectorAll("tr");
    if (!rows.length) return;
    const mm = staggerIn(rows, { y: 6, stagger: 0.04 });
    return () => mm.revert();
  }, [reports, activeTab]);

  // Close the detail modal whenever the user leaves the history tab.
  useEffect(() => {
    if (activeTab !== "history") setSelectedHistoryReport(null);
  }, [activeTab]);

  async function loadReports() {
    setLoading(true);
    setErrorMessage("");

    try {
      const response = await axios.get(`${API_BASE_URL}/api/community/moderation/reports`, {
        headers: getAuthHeaders()
      });
      setReports(response.data.reports || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to load moderation reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadReports();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    // Keep queue fresh when new reports are filed or reviewed by another moderator.
    moderationSocket.auth = { token };
    moderationSocket.connect();
    moderationSocket.emit("joinModerationFeed");

    const refresh = () => loadReports();

    moderationSocket.on("community:report-created", refresh);
    moderationSocket.on("community:report-reviewed", refresh);

    return () => {
      moderationSocket.off("community:report-created", refresh);
      moderationSocket.off("community:report-reviewed", refresh);
      moderationSocket.disconnect();
    };
  }, []);

  /**
   * @param {string} reportId - contentReportId of the report to review
   * @param {"APPROVED"|"REJECTED"} reviewStatus
   * @param {"remove_message"|"ban_user"|"none"} action - downstream side-effect
   */
  async function review(reportId, reviewStatus, action = "none") {
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await axios.patch(
        `${API_BASE_URL}/api/community/moderation/reports/${reportId}`,
        { reviewStatus, action },
        { headers: getAuthHeaders() }
      );
      setSuccessMessage("Moderation action saved.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to review report.");
    }
  }

  return (
    <main className="moderation-page">
      <section className="moderation-shell">
        <header className="moderation-header">
          <h1>Moderation Dashboard</h1>
          <p>Review flagged content and apply safety actions.</p>
        </header>

        <nav className="moderation-tab-bar" aria-label="Moderation views">
          <button
            type="button"
            className={`moderation-tab-btn${activeTab === "pending" ? " active" : ""}`}
            onClick={() => setActiveTab("pending")}
          >
            Pending Queue
          </button>
          <button
            type="button"
            className={`moderation-tab-btn${activeTab === "history" ? " active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            Review History
          </button>
        </nav>

        {errorMessage && <p className="status-message warning">{errorMessage}</p>}
        {successMessage && <p className="status-message">{successMessage}</p>}

        {/* ── Pending Queue tab ── */}
        {activeTab === "pending" && (
          <>
            {loading ? (
              <p className="wa-empty-state">Loading reports...</p>
            ) : pendingReports.length === 0 ? (
              <p className="wa-empty-state">No pending reports.</p>
            ) : (
              <section
                className="moderation-grid"
                aria-label="Pending report queue"
                ref={gridRef}
              >
                {pendingReports.map((report) => (
                  <article key={report.contentReportId} className="moderation-card">
                    <div>
                      <p><strong>Reason:</strong> {report.reportReasonText}</p>
                      <p>
                        <strong>Reporter:</strong>{" "}
                        {report.reporter?.displayName || "Community Member"}
                      </p>
                      <p>
                        <strong>Message:</strong>{" "}
                        {report.reportedMessage?.publicMessageContent || "Message unavailable"}
                      </p>
                      <p>
                        <strong>Author:</strong>{" "}
                        {report.reportedMessage?.author?.displayName || "Unknown"}
                      </p>
                      <p>
                        <strong>Reported:</strong>{" "}
                        {new Date(report.reportSubmissionTimestamp).toLocaleString()}
                      </p>
                    </div>

                    <div className="moderation-actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => review(report.contentReportId, "REJECTED", "none")}
                      >
                        Reject Report
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => review(report.contentReportId, "APPROVED", "remove_message")}
                      >
                        Approve + Remove Message
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => review(report.contentReportId, "APPROVED", "ban_user")}
                      >
                        Approve + Ban User
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        {/* ── Review History tab ── */}
        {activeTab === "history" && (
          <>
            {loading ? (
              <p className="wa-empty-state">Loading history...</p>
            ) : reviewedReports.length === 0 ? (
              <p className="wa-empty-state">No reviewed reports yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Reported Message</th>
                      <th>Author</th>
                      <th>Reporter</th>
                      <th>Submitted</th>
                      <th>Outcome</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody ref={historyBodyRef}>
                    {reviewedReports.map((report) => (
                      <tr
                        key={report.contentReportId}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedHistoryReport(report)}
                      >
                        <td>
                          {(report.reportedMessage?.publicMessageContent || "").slice(0, 60)}
                          {(report.reportedMessage?.publicMessageContent || "").length > 60 ? "…" : ""}
                        </td>
                        <td>{report.reportedMessage?.author?.displayName || "Unknown"}</td>
                        <td>{report.reporter?.displayName || "Community Member"}</td>
                        <td>{new Date(report.reportSubmissionTimestamp).toLocaleDateString()}</td>
                        <td>{resolveOutcomeLabel(report)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedHistoryReport(report);
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── History detail modal ── */}
      {selectedHistoryReport && (
        <div
          className="admin-confirm-overlay"
          role="presentation"
          onClick={() => setSelectedHistoryReport(null)}
        >
          <article
            className="admin-confirm-modal report-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="history-modal-title">Review Details</h3>

            <p>
              <strong>Reported message:</strong>{" "}
              {selectedHistoryReport.reportedMessage?.publicMessageContent || "Message unavailable"}
            </p>
            <p>
              <strong>Message author:</strong>{" "}
              {selectedHistoryReport.reportedMessage?.author?.displayName || "Unknown"}
            </p>
            <p>
              <strong>Reported by:</strong>{" "}
              {selectedHistoryReport.reporter?.displayName || "Community Member"}
            </p>
            <p>
              <strong>Report reason:</strong> {selectedHistoryReport.reportReasonText}
            </p>
            <p>
              <strong>Submitted:</strong>{" "}
              {new Date(selectedHistoryReport.reportSubmissionTimestamp).toLocaleString()}
            </p>
            <p>
              <strong>Outcome:</strong>{" "}
              {resolveOutcomeLabel(selectedHistoryReport)}
            </p>

            <div className="admin-confirm-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setSelectedHistoryReport(null)}
              >
                Close
              </button>
            </div>
          </article>
        </div>
      )}
    </main>
  );
}

export default ModerationDashboardPage;
