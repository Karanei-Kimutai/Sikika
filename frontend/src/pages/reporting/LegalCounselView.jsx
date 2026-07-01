import { useState } from "react";
import {
  getEvidenceAccessUrl,
  updateReportStatus
} from "../../services/reports";
import {
  saveLegalCaseDraft,
  updateLegalCaseStatus,
  generateLegalCaseDocument,
  getLegalCaseDocumentUrl
} from "../../services/legalCases";
import useReportHighlight from "./useReportHighlight";

const STATUS_OPTIONS = [
  "SUBMITTED", "UNDER_REVIEW", "ACTIVE_SUPPORT", "UNDER_INVESTIGATION",
  "LEGAL_REVIEW", "ESCALATED_TO_LEGAL_CASE", "RESOLVED", "WITHDRAWN"
];

const CASE_NEXT_STATUSES = {
  OPEN: ["UNDER_INVESTIGATION"],
  UNDER_INVESTIGATION: ["READY_FOR_SUBMISSION"],
  READY_FOR_SUBMISSION: ["SUBMITTED"],
  SUBMITTED: ["CLOSED"],
  CLOSED: []
};

/**
 * LegalCounselView
 * ----------------
 * Report list for LEGAL_COUNSEL role. Includes the full structured
 * legal-case drafting panel (4 authoring fields, Save Draft, Generate Document,
 * Open Document, case status advance) plus report-level status update.
 *
 * @param {{ reports: object[], loading: boolean,
 *   loadReports: Function,
 *   setErrorMessage: Function, setSuccessMessage: Function,
 *   highlightReportId: string }} props
 */
export default function LegalCounselView({
  reports, loading, loadReports, setErrorMessage, setSuccessMessage, highlightReportId
}) {
  const highlightedId = useReportHighlight(reports, highlightReportId);
  const [reportStatusMap, setReportStatusMap] = useState({});
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");

  // Legal draft local state keyed by legalCaseId
  const [legalDraftByCase, setLegalDraftByCase] = useState({});
  const [savingDraftId, setSavingDraftId] = useState("");
  const [updatingCaseStatusId, setUpdatingCaseStatusId] = useState("");
  const [generatingDocId, setGeneratingDocId] = useState("");
  const [openingDocId, setOpeningDocId] = useState("");

  const formatStatus = (s) =>
    String(s || "").toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  const handleStatusUpdate = async (reportId, reportStatus) => {
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

  /**
   * Seeds local draft from legalCase API response data on first access.
   * @param {object} legalCase
   */
  const initLegalDraft = (legalCase) => {
    if (!legalCase?.legalCaseId) return;
    setLegalDraftByCase((prev) => {
      if (prev[legalCase.legalCaseId]) return prev;
      return {
        ...prev,
        [legalCase.legalCaseId]: {
          caseSummary: legalCase.caseSummary || "",
          legalGroundsText: legalCase.legalGroundsText || "",
          requestedReliefText: legalCase.requestedReliefText || "",
          recommendedActionsText: legalCase.recommendedActionsText || ""
        }
      };
    });
  };

  const handleLegalDraftChange = (legalCaseId, field, value) => {
    setLegalDraftByCase((prev) => ({
      ...prev,
      [legalCaseId]: { ...(prev[legalCaseId] || {}), [field]: value }
    }));
  };

  const handleSaveLegalDraft = async (legalCaseId) => {
    setSavingDraftId(legalCaseId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await saveLegalCaseDraft(legalCaseId, legalDraftByCase[legalCaseId] || {});
      setSuccessMessage("Legal case draft saved.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not save legal case draft.");
    } finally {
      setSavingDraftId("");
    }
  };

  const handleUpdateCaseStatus = async (legalCaseId, nextStatus) => {
    // Same rationale as handleStatusUpdate above: CLOSED is a terminal state
    // for the case, so require an explicit confirmation before committing to it.
    if (nextStatus === "CLOSED") {
      const confirmed = window.confirm("Close this legal case now? This should only be done when the case is fully complete.");
      if (!confirmed) return;
    }

    setUpdatingCaseStatusId(legalCaseId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await updateLegalCaseStatus(legalCaseId, nextStatus);
      setSuccessMessage(`Case status updated to ${nextStatus}.`);
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update case status.");
    } finally {
      setUpdatingCaseStatusId("");
    }
  };

  const handleGenerateDocument = async (legalCaseId) => {
    setGeneratingDocId(legalCaseId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await generateLegalCaseDocument(legalCaseId);
      setSuccessMessage("Legal case document generated successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not generate legal case document.");
    } finally {
      setGeneratingDocId("");
    }
  };

  const handleOpenLegalDocument = async (legalCaseId) => {
    setOpeningDocId(legalCaseId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      const data = await getLegalCaseDocumentUrl(legalCaseId);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not open legal case document.");
    } finally {
      setOpeningDocId("");
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
        <h2>No assigned cases</h2>
        <p>You have no legal cases or reports assigned to you at this time.</p>
      </section>
    );
  }

  return (
    <section className="resource-grid" aria-label="Assigned legal cases">
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
              <section
                className="legal-draft-panel"
                aria-label={`Legal case drafting — ${report.legalCase.legalCaseId}`}
                onFocus={() => initLegalDraft(report.legalCase)}
              >
                <h3 className="legal-draft-heading">
                  Legal Case File
                  <span className="legal-draft-status-badge">{report.legalCase.caseStatus}</span>
                </h3>
                <p className="legal-draft-meta">
                  Case ID: {report.legalCase.legalCaseId}
                  {report.legalCase.draftLastUpdatedAt
                    ? ` · Draft saved ${new Date(report.legalCase.draftLastUpdatedAt).toLocaleString()}`
                    : ""}
                  {report.legalCase.documentGeneratedAt
                    ? ` · Document generated ${new Date(report.legalCase.documentGeneratedAt).toLocaleString()}`
                    : ""}
                </p>

                {[
                  { key: "caseSummary", label: "Case Summary", hint: "Narrative overview of the case." },
                  { key: "legalGroundsText", label: "Legal Grounds", hint: "Statutory or common-law basis, e.g. Sexual Offences Act (2006), Section 3." },
                  { key: "requestedReliefText", label: "Requested Relief", hint: "Specific remedy or protection order being sought." },
                  { key: "recommendedActionsText", label: "Recommended Next Steps", hint: "Manual handover actions — this platform does not contact any external party directly." }
                ].map(({ key, label, hint }) => (
                  <label key={key} className="legal-draft-field">
                    <span className="legal-draft-label">{label}</span>
                    <span className="legal-draft-hint">{hint}</span>
                    <textarea
                      rows={3}
                      value={legalDraftByCase[report.legalCase.legalCaseId]?.[key] ?? report.legalCase[key] ?? ""}
                      onChange={(e) => handleLegalDraftChange(report.legalCase.legalCaseId, key, e.target.value)}
                      onFocus={() => initLegalDraft(report.legalCase)}
                      placeholder={`Enter ${label.toLowerCase()}…`}
                    />
                  </label>
                ))}

                <div className="legal-draft-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => handleSaveLegalDraft(report.legalCase.legalCaseId)}
                    disabled={savingDraftId === report.legalCase.legalCaseId}
                  >
                    {savingDraftId === report.legalCase.legalCaseId ? "Saving…" : "Save Draft"}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleGenerateDocument(report.legalCase.legalCaseId)}
                    disabled={generatingDocId === report.legalCase.legalCaseId}
                  >
                    {generatingDocId === report.legalCase.legalCaseId ? "Generating…" : "Generate Document"}
                  </button>
                  {report.legalCase.generatedDocumentPath && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleOpenLegalDocument(report.legalCase.legalCaseId)}
                      disabled={openingDocId === report.legalCase.legalCaseId}
                    >
                      {openingDocId === report.legalCase.legalCaseId ? "Opening…" : "Open Document"}
                    </button>
                  )}
                </div>

                {(() => {
                  const nextOptions = CASE_NEXT_STATUSES[report.legalCase.caseStatus] || [];
                  if (nextOptions.length === 0) return null;
                  return (
                    <div className="legal-draft-status-advance">
                      <label className="status-select-label" htmlFor={`case-status-${report.legalCase.legalCaseId}`}>
                        Advance case status
                        <select
                          id={`case-status-${report.legalCase.legalCaseId}`}
                          defaultValue=""
                          disabled={updatingCaseStatusId === report.legalCase.legalCaseId}
                          onChange={(e) => {
                            if (e.target.value) handleUpdateCaseStatus(report.legalCase.legalCaseId, e.target.value);
                          }}
                        >
                          <option value="" disabled>Select next status…</option>
                          {nextOptions.map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  );
                })()}
              </section>
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
