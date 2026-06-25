import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import useReportHighlight from "./useReportHighlight";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  createReport,
  deleteOwnReport,
  getEvidenceAccessUrl,
  uploadEvidence,
  updateOwnReport,
  withdrawReport
} from "../../services/reports";
import {
  getMyReassignmentRequests as fetchMyReassignmentRequests,
  createMyReassignmentRequest as submitMyReassignmentRequest,
  cancelMyReassignmentRequest as cancelReassignmentRequest
} from "../../services/admin";

/**
 * SurvivorReportView
 * ------------------
 * Report page for SURVIVOR role. Shows the create-report form, reassignment
 * requests, and a full per-report action panel (edit, evidence, withdraw, delete).
 *
 * @param {{ reports: object[], loading: boolean, errorMessage: string,
 *   successMessage: string, loadReports: Function,
 *   setErrorMessage: Function, setSuccessMessage: Function,
 *   onNavigate: Function, highlightReportId: string }} props
 */
export default function SurvivorReportView({
  reports, loading, loadReports, onNavigate,
  setErrorMessage, setSuccessMessage, highlightReportId
}) {
  const highlightedId = useReportHighlight(reports, highlightReportId);
  // ── Create report form state ──────────────────────────────────────────────
  const [category, setCategory] = useState("");
  const [severityLevel, setSeverityLevel] = useState("MEDIUM");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Evidence state ────────────────────────────────────────────────────────
  const [selectedEvidenceByReport, setSelectedEvidenceByReport] = useState({});
  const [uploadingEvidenceFor, setUploadingEvidenceFor] = useState("");
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");

  // ── Inline edit state ─────────────────────────────────────────────────────
  const [editingReportId, setEditingReportId] = useState("");
  const [editingPayload, setEditingPayload] = useState({
    category: "", severityLevel: "MEDIUM", description: "", location: "", date: ""
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Delete state ──────────────────────────────────────────────────────────
  const [deletingReportId, setDeletingReportId] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");

  // ── Reassignment state ────────────────────────────────────────────────────
  const [requestScope, setRequestScope] = useState("BOTH");
  const [requestReasonText, setRequestReasonText] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestCancellingId, setRequestCancellingId] = useState("");
  const [reassignmentRequests, setReassignmentRequests] = useState([]);

  useEffect(() => {
    fetchMyReassignmentRequests()
      .then((data) => setReassignmentRequests(data.requests || []))
      .catch(() => {});
  }, []);

  const refreshReassignmentRequests = async () => {
    const data = await fetchMyReassignmentRequests();
    setReassignmentRequests(data.requests || []);
  };

  const handleCreateReport = async (e) => {
    e.preventDefault();
    if (!category.trim() || !description.trim()) {
      setErrorMessage("Category and description are required.");
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await createReport({ category: category.trim(), severityLevel, description: description.trim(), location: location.trim(), date: incidentDate || undefined });
      setCategory(""); setSeverityLevel("MEDIUM"); setDescription(""); setLocation(""); setIncidentDate("");
      setSuccessMessage("Report submitted successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReassignmentRequest = async (e) => {
    e.preventDefault();
    if (!requestReasonText.trim()) { setErrorMessage("Please provide a reason for the reassignment request."); return; }
    setRequestSubmitting(true);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await submitMyReassignmentRequest({ requestedScope: requestScope, requestReasonText: requestReasonText.trim() });
      setRequestReasonText(""); setRequestScope("BOTH");
      setSuccessMessage("Your reassignment request has been submitted.");
      await refreshReassignmentRequests();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not submit reassignment request.");
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleCancelReassignmentRequest = async (requestId) => {
    setRequestCancellingId(requestId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await cancelReassignmentRequest(requestId);
      setSuccessMessage("Reassignment request cancelled.");
      await refreshReassignmentRequests();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not cancel reassignment request.");
    } finally {
      setRequestCancellingId("");
    }
  };

  const handleEvidenceUpload = async (reportId) => {
    const file = selectedEvidenceByReport[reportId];
    if (!file) { setErrorMessage("Select a file before uploading evidence."); return; }
    setUploadingEvidenceFor(reportId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await uploadEvidence(reportId, file);
      setSelectedEvidenceByReport((c) => { const n = { ...c }; delete n[reportId]; return n; });
      setSuccessMessage("Evidence uploaded successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not upload evidence.");
    } finally {
      setUploadingEvidenceFor("");
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

  const startEdit = (report) => {
    setEditingReportId(report.reportId);
    setEditingPayload({ category: report.category || "", severityLevel: report.severityLevel || "MEDIUM", description: report.description || "", location: report.location || "", date: report.date || "" });
    setErrorMessage(""); setSuccessMessage("");
  };

  const cancelEdit = () => { setEditingReportId(""); setSavingEdit(false); };

  const handleSaveEdit = async () => {
    if (!editingReportId) return;
    if (!editingPayload.category.trim() || !editingPayload.description.trim()) {
      setErrorMessage("Category and description are required."); return;
    }
    setSavingEdit(true);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await updateOwnReport(editingReportId, {
        category: editingPayload.category.trim(), severityLevel: editingPayload.severityLevel,
        description: editingPayload.description.trim(), location: editingPayload.location.trim(),
        date: editingPayload.date || undefined
      });
      setSuccessMessage("Report updated."); cancelEdit(); await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update report.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleWithdraw = async (reportId) => {
    setErrorMessage(""); setSuccessMessage("");
    try {
      await withdrawReport(reportId);
      setSuccessMessage("Report withdrawn."); await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not withdraw report.");
    }
  };

  const handleDeleteConfirm = async () => {
    const reportId = deleteConfirmId;
    setDeleteConfirmId(""); setDeletingReportId(reportId);
    setErrorMessage(""); setSuccessMessage("");
    try {
      await deleteOwnReport(reportId);
      if (editingReportId === reportId) cancelEdit();
      setSuccessMessage("Report deleted."); await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not delete report.");
    } finally {
      setDeletingReportId("");
    }
  };

  const formatStatus = (s) => String(s || "").toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  return (
    <>
      <section className="library-toolbar" aria-label="Create report form">
        <form className="report-form" onSubmit={handleCreateReport}>
          <label htmlFor="report-category">Category<input id="report-category" type="text" placeholder="e.g. domestic_violence" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label htmlFor="report-severity">Severity
            <select id="report-severity" value={severityLevel} onChange={(e) => setSeverityLevel(e.target.value)}>
              <option value="LOW">Low</option><option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option><option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label htmlFor="report-description">Description<textarea id="report-description" rows={4} placeholder="Describe what happened" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label htmlFor="report-location">Location<input id="report-location" type="text" placeholder="Incident location" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label htmlFor="report-date">Incident date<input id="report-date" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} /></label>
          <button type="submit" className="primary-btn" disabled={submitting}>{submitting ? "Submitting..." : "Submit Report"}</button>
        </form>
      </section>

      <section className="library-toolbar" aria-label="Request staff reassignment">
        <form className="report-form" onSubmit={handleSubmitReassignmentRequest}>
          <h2>Request Staff Reassignment</h2>
          <p>If you need a different support staff assignment, submit a request and the NGO team will review it.</p>
          <label htmlFor="request-scope">Requested change
            <select id="request-scope" value={requestScope} onChange={(e) => setRequestScope(e.target.value)}>
              <option value="BOTH">Counsellor and Legal Counsel</option>
              <option value="COUNSELLOR">Counsellor only</option>
              <option value="LEGAL_COUNSEL">Legal Counsel only</option>
            </select>
          </label>
          <label htmlFor="request-reason">Reason<textarea id="request-reason" rows={3} placeholder="Describe why reassignment would improve your support." value={requestReasonText} onChange={(e) => setRequestReasonText(e.target.value)} /></label>
          <button type="submit" className="primary-btn" disabled={requestSubmitting}>{requestSubmitting ? "Submitting..." : "Submit Reassignment Request"}</button>
        </form>
        <div className="admin-table-wrap" style={{ marginTop: "1rem" }}>
          <table className="admin-table">
            <thead><tr><th>Requested</th><th>Scope</th><th>Status</th><th>Review Note</th><th>Action</th></tr></thead>
            <tbody>
              {reassignmentRequests.map((req) => (
                <tr key={req.requestId}>
                  <td>{req.requestTimestamp ? new Date(req.requestTimestamp).toLocaleString() : "-"}</td>
                  <td>{formatStatus(req.requestedScope)}</td><td>{formatStatus(req.requestStatus)}</td>
                  <td>{req.ngoAdminReviewNote || "-"}</td>
                  <td>{req.requestStatus === "PENDING" ? (
                    <button type="button" className="secondary-btn" onClick={() => handleCancelReassignmentRequest(req.requestId)} disabled={requestCancellingId === req.requestId}>
                      {requestCancellingId === req.requestId ? "Cancelling..." : "Cancel"}
                    </button>) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reassignmentRequests.length === 0 && (
            <p className="admin-empty" style={{ marginTop: "0.6rem" }}>
              <Inbox size={18} aria-hidden="true" />
              No reassignment requests submitted yet.
            </p>
          )}
        </div>
      </section>

      {loading ? (
        <div aria-busy="true" aria-label="Loading reports" style={{ padding: "1rem" }}>
          {Array.from({ length: 3 }).map((_, i) => (<div key={i} className="skeleton skeleton-card" style={{ marginBottom: "0.75rem" }} />))}
        </div>
      ) : reports.length === 0 ? (
        <section className="empty-state">
          <h2>No reports yet</h2><p>Create a report to begin tracking support progress.</p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate("/join")}>Go to account page</button>
        </section>
      ) : (
        <section className="resource-grid" aria-label="Incident reports list">
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
                {report.legalCase && <p><strong>Legal case:</strong> {report.legalCase.caseStatus}{report.legalCase.legalCaseId ? ` (${report.legalCase.legalCaseId})` : ""}</p>}
              </div>

              <div className="report-actions">
                {report.reportStatus === "SUBMITTED" && editingReportId !== report.reportId && (
                  <button type="button" className="secondary-btn" onClick={() => startEdit(report)}>Edit Draft</button>
                )}
                {editingReportId === report.reportId && (
                  <div className="inline-edit-block">
                    <label htmlFor={`edit-category-${report.reportId}`}>Category<input id={`edit-category-${report.reportId}`} type="text" value={editingPayload.category} onChange={(e) => setEditingPayload((c) => ({ ...c, category: e.target.value }))} /></label>
                    <label htmlFor={`edit-severity-${report.reportId}`}>Severity
                      <select id={`edit-severity-${report.reportId}`} value={editingPayload.severityLevel} onChange={(e) => setEditingPayload((c) => ({ ...c, severityLevel: e.target.value }))}>
                        <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option>
                      </select>
                    </label>
                    <label htmlFor={`edit-description-${report.reportId}`}>Description<textarea id={`edit-description-${report.reportId}`} rows={3} value={editingPayload.description} onChange={(e) => setEditingPayload((c) => ({ ...c, description: e.target.value }))} /></label>
                    <label htmlFor={`edit-location-${report.reportId}`}>Location<input id={`edit-location-${report.reportId}`} type="text" value={editingPayload.location} onChange={(e) => setEditingPayload((c) => ({ ...c, location: e.target.value }))} /></label>
                    <label htmlFor={`edit-date-${report.reportId}`}>Incident date<input id={`edit-date-${report.reportId}`} type="date" value={editingPayload.date} onChange={(e) => setEditingPayload((c) => ({ ...c, date: e.target.value }))} /></label>
                    <div className="inline-edit-actions">
                      <button type="button" className="primary-btn" onClick={handleSaveEdit} disabled={savingEdit}>{savingEdit ? "Saving..." : "Save Changes"}</button>
                      <button type="button" className="secondary-btn" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                )}

                {report.reportStatus !== "WITHDRAWN" && (
                  <div className="evidence-upload-block">
                    <label htmlFor={`evidence-${report.reportId}`}>Add evidence</label>
                    <input id={`evidence-${report.reportId}`} type="file" accept="image/*,application/pdf,audio/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (file && file.size > 15 * 1024 * 1024) { setErrorMessage("Evidence file must be 15MB or smaller."); return; }
                        setSelectedEvidenceByReport((c) => ({ ...c, [report.reportId]: file }));
                      }}
                    />
                    <small>Accepted: images, PDF, audio. Max size: 15MB.</small>
                    <button type="button" className="secondary-btn" onClick={() => handleEvidenceUpload(report.reportId)} disabled={uploadingEvidenceFor === report.reportId || !selectedEvidenceByReport[report.reportId]}>
                      {uploadingEvidenceFor === report.reportId ? "Uploading..." : "Upload Evidence"}
                    </button>
                  </div>
                )}

                {(report.evidence || []).length > 0 && (
                  <div className="evidence-list">
                    <strong>Evidence files</strong>
                    {(report.evidence || []).map((ev) => (
                      <button type="button" key={ev.evidenceId} className="footer-link" onClick={() => handleOpenEvidence(report.reportId, ev.evidenceId)} disabled={openingEvidenceId === ev.evidenceId}>
                        {openingEvidenceId === ev.evidenceId ? "Opening..." : ev.originalFileName || `${ev.fileType} evidence`}
                      </button>
                    ))}
                  </div>
                )}

                {report.reportStatus !== "WITHDRAWN" && (
                  <button type="button" className="secondary-btn" onClick={() => handleWithdraw(report.reportId)}>Withdraw</button>
                )}
                <button type="button" className="secondary-btn" onClick={() => setDeleteConfirmId(report.reportId)} disabled={deletingReportId === report.reportId}>
                  {deletingReportId === report.reportId ? "Deleting..." : "Delete Permanently"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Delete Report Permanently"
        message="This report will be permanently deleted and cannot be recovered. Are you sure?"
        confirmLabel="Delete" cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm} onCancel={() => setDeleteConfirmId("")}
        variant="danger"
      />
    </>
  );
}
