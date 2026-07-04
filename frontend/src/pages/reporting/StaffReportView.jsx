import { useState } from "react";
import { getEvidenceAccessUrl, updateReportStatus } from "../../services/reports";
import useReportHighlight from "./useReportHighlight";
import { getAllowedNextStatuses } from "../../utils/reportStatusRules";

/**
 * StaffReportView
 * ---------------
 * Report list for COUNSELLOR and NGO_ADMIN roles. Shows all assigned reports
 * with a status-update select. Read-only legal case summary when present.
 * The status select is gated to only offer statuses this role can actually
 * set from the report's current status (see reportStatusRules.js) — an
 * option that would be rejected by the backend is never shown.
 *
 * @param {{ reports: object[], loading: boolean,
 *   loadReports: Function,
 *   setErrorMessage: Function, setSuccessMessage: Function,
 *   highlightReportId: string, role: string }} props
 */
export default function StaffReportView({
  reports, loading, loadReports, setErrorMessage, setSuccessMessage, highlightReportId, role
}) {
  const highlightedId = useReportHighlight(reports, highlightReportId);
  const [reportStatusMap, setReportStatusMap] = useState({});
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");

  const formatStatus = (s) =>
    String(s || "").toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  const handleStatusUpdate = async (reportId, reportStatus, currentStatus) => {
    // Extra confirmation gate for terminal, hard-to-reverse transitions —
    // guards against accidentally closing out an active support workflow
    // with a single misclick.
    if (reportStatus === "RESOLVED" || reportStatus === "WITHDRAWN") {
      const confirmed = window.confirm(`Set this report to ${reportStatus.replace(/_/g, " ")}? This action can affect active support workflows.`);
      if (!confirmed) return;
    }

    setErrorMessage(""); setSuccessMessage("");
    try {
      await updateReportStatus(reportId, reportStatus, true);
      setSuccessMessage("Report status updated.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update report status.");
      // Revert the optimistic selection — the transition was rejected, so the
      // dropdown must not keep showing a status that was never applied.
      setReportStatusMap((m) => ({ ...m, [reportId]: currentStatus }));
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

            {(() => {
              const allowedNext = getAllowedNextStatuses(report.reportStatus, role);
              if (allowedNext.length === 0) {
                return (
                  <p className="status-select-label">
                    Status
                    <span className="resource-category">{formatStatus(report.reportStatus)}</span>
                  </p>
                );
              }
              const options = [report.reportStatus, ...allowedNext.filter((s) => s !== report.reportStatus)];
              return (
                <label className="status-select-label" htmlFor={`status-${report.reportId}`}>
                  Update status
                  <select
                    id={`status-${report.reportId}`}
                    value={reportStatusMap[report.reportId] ?? report.reportStatus}
                    onChange={(e) => {
                      setReportStatusMap((m) => ({ ...m, [report.reportId]: e.target.value }));
                      handleStatusUpdate(report.reportId, e.target.value, report.reportStatus);
                    }}
                  >
                    {options.map((s) => (
                      <option key={s} value={s}>{formatStatus(s)}</option>
                    ))}
                  </select>
                </label>
              );
            })()}
          </div>
        </article>
      ))}
    </section>
  );
}
