import { useState } from "react";
import { getEvidenceAccessUrl, updateReportStatus } from "../../services/reports";
import useReportHighlight from "./useReportHighlight";

const STATUS_OPTIONS = [
  "SUBMITTED", "UNDER_REVIEW", "ACTIVE_SUPPORT", "UNDER_INVESTIGATION",
  "LEGAL_REVIEW", "ESCALATED_TO_LEGAL_CASE", "RESOLVED", "WITHDRAWN"
];

/**
 * StaffReportView
 * ---------------
 * Report list for COUNSELLOR and NGO_ADMIN roles. Shows all assigned reports
 * with a status-update select. Read-only legal case summary when present.
 *
 * @param {{ reports: object[], loading: boolean,
 *   loadReports: Function,
 *   setErrorMessage: Function, setSuccessMessage: Function,
 *   highlightReportId: string }} props
 */
export default function StaffReportView({
  reports, loading, loadReports, setErrorMessage, setSuccessMessage, highlightReportId
}) {
  const highlightedId = useReportHighlight(reports, highlightReportId);
  const [reportStatusMap, setReportStatusMap] = useState({});
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");

  const formatStatus = (s) =>
    String(s || "").toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  const handleStatusUpdate = async (reportId, reportStatus) => {
    setErrorMessage(""); setSuccessMessage("");
    try {
      await updateReportStatus(reportId, reportStatus, true);
      setSuccessMessage("Report status updated.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update report status.");
    }
  };

  const handleOpenEvidence = async (reportId, evidenceId) => {
    setOpeningEvidenceId(evidenceId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      const data = await getEvidenceAccessUrl(reportId, evidenceId);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not open evidence file.");
    } finally {
      setOpeningEvidenceId("");
    }
  };

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading reports" style={{ padding: "1rem" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-card" style={{ marginBottom: "0.75rem" }} />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <section className="empty-state">
        <h2>No assigned reports</h2>
        <p>You have no reports assigned to you at this time.</p>
      </section>
    );
  }

  return (
    <section className="resource-grid" aria-label="Assigned incident reports">
      {reports.map((report) => (
        <article
          className={`resource-tile${report.reportId === highlightedId ? " resource-tile--highlighted" : ""}`}
          id={`report-${report.reportId}`}
          key={report.reportId}
        >
          <div>
            <span className="resource-category">{formatStatus(report.reportStatus)}</span>
            <h2>{report.category}</h2>
            <p><strong>Report ID:</strong> {report.reportId}</p>
            <p><strong>Submitted:</strong> {report.createdAt ? new Date(report.createdAt).toLocaleString() : "-"}</p>
            <p>{report.description}</p>
            <p><strong>Severity:</strong> {report.severityLevel}</p>
            <p><strong>Location:</strong> {report.location || "Not provided"}</p>
            <p><strong>Date:</strong> {report.date || "Not provided"}</p>
            {report.legalCase && (
              <p><strong>Legal case:</strong> {report.legalCase.caseStatus}{report.legalCase.legalCaseId ? ` (${report.legalCase.legalCaseId})` : ""}</p>
            )}
          </div>

          <div className="report-actions">
            {(report.evidence || []).length > 0 && (
              <div className="evidence-list">
                <strong>Evidence files</strong>
                {(report.evidence || []).map((ev) => (
                  <button
                    type="button"
                    key={ev.evidenceId}
                    className="footer-link"
                    onClick={() => handleOpenEvidence(report.reportId, ev.evidenceId)}
                    disabled={openingEvidenceId === ev.evidenceId}
                  >
                    {openingEvidenceId === ev.evidenceId
                      ? "Opening..."
                      : ev.originalFileName || `${ev.fileType} evidence`}
                  </button>
                ))}
              </div>
            )}

            <label className="status-select-label" htmlFor={`status-${report.reportId}`}>
              Update status
              <select
                id={`status-${report.reportId}`}
                value={reportStatusMap[report.reportId] ?? report.reportStatus}
                onChange={(e) => {
                  setReportStatusMap((m) => ({ ...m, [report.reportId]: e.target.value }));
                  handleStatusUpdate(report.reportId, e.target.value);
                }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{formatStatus(s)}</option>
                ))}
              </select>
            </label>
          </div>
        </article>
      ))}
    </section>
  );
}
