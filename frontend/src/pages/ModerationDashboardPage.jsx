import { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

/**
 * ModerationDashboardPage
 * -----------------------
 * Focused queue for reviewing harmful-content reports.
 *
 * Design notes:
 * - uses REST for initial list + mutation actions
 * - subscribes to moderation socket feed for near-real-time refreshes
 * - backend remains source-of-truth for moderation permissions
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const moderationSocket = io(API_BASE_URL, { autoConnect: false });

function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function ModerationDashboardPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

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
    const token = localStorage.getItem("authToken");
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

  async function review(reportId, reviewStatus, action = "none") {
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // `action` controls downstream moderation behavior (remove_message/ban_user/none).
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

        {errorMessage && <p className="status-message warning">{errorMessage}</p>}
        {successMessage && <p className="status-message">{successMessage}</p>}

        {loading ? (
          <p className="wa-empty-state">Loading reports...</p>
        ) : reports.length === 0 ? (
          <p className="wa-empty-state">No reported content at the moment.</p>
        ) : (
          <section className="moderation-grid" aria-label="Reported content queue">
            {reports.map((report) => (
              <article key={report.contentReportId} className="moderation-card">
                <div>
                  <strong>Review Status: {report.moderationReviewStatus}</strong>
                  <p><strong>Reason:</strong> {report.reportReasonText}</p>
                  <p>
                    <strong>Reporter:</strong> {report.reporter?.displayName || "Community Member"}
                  </p>
                  <p>
                    <strong>Message:</strong>{" "}
                    {report.reportedMessage?.publicMessageContent || "Message unavailable"}
                  </p>
                  <p>
                    <strong>Author:</strong> {report.reportedMessage?.author?.displayName || "Unknown"}
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
      </section>
    </main>
  );
}

export default ModerationDashboardPage;
