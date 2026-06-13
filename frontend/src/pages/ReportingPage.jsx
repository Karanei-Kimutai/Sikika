import { useEffect, useMemo, useState } from "react";
import { getToken } from "../utils/auth";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  createReport,
  deleteOwnReport,
  getEvidenceAccessUrl,
  getReports,
  uploadEvidence,
  updateOwnReport,
  updateReportStatus,
  withdrawReport
} from "../services/reports";
import {
  getMyReassignmentRequests as fetchMyReassignmentRequests,
  createMyReassignmentRequest as submitMyReassignmentRequest,
  cancelMyReassignmentRequest as cancelReassignmentRequest
} from "../services/admin";
import {
  saveLegalCaseDraft,
  updateLegalCaseStatus,
  generateLegalCaseDocument,
  getLegalCaseDocumentUrl
} from "../services/legalCases";

const STATUS_OPTIONS = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACTIVE_SUPPORT",
  "UNDER_INVESTIGATION",
  "LEGAL_REVIEW",
  "ESCALATED_TO_LEGAL_CASE",
  "RESOLVED",
  "WITHDRAWN"
];

// Staff may see all options in the UI, but backend enforces exact role-based
// transitions and can reject disallowed status changes.

function decodeTokenRole() {
  const token = getToken();
  if (!token) return "";

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function formatStatus(status) {
  return String(status || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ReportingPage({ onNavigate }) {
  const role = useMemo(() => decodeTokenRole(), []);
  // Survivors can create/edit/withdraw/delete their own reports.
  const canCreate = role === "SURVIVOR";
  // Staff users can request status updates subject to backend transition rules.
  const canUpdateStatus = ["COUNSELLOR", "LEGAL_COUNSEL", "NGO_ADMIN"].includes(role);

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [category, setCategory] = useState("");
  const [severityLevel, setSeverityLevel] = useState("MEDIUM");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedEvidenceByReport, setSelectedEvidenceByReport] = useState({});
  const [uploadingEvidenceFor, setUploadingEvidenceFor] = useState("");
  const [editingReportId, setEditingReportId] = useState("");
  const [editingPayload, setEditingPayload] = useState({
    category: "",
    severityLevel: "MEDIUM",
    description: "",
    location: "",
    date: ""
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");
  const [reportStatusMap, setReportStatusMap] = useState({});
  const [reassignmentRequests, setReassignmentRequests] = useState([]);

  // ── Legal case drafting state (legal counsel only) ─────────────────────────
  // Tracks the draft fields being edited for a specific case, keyed by legalCaseId.
  const [legalDraftByCase, setLegalDraftByCase] = useState({});
  // Which legalCaseId is currently being saved (shows spinner on the Save button).
  const [savingDraftId, setSavingDraftId] = useState("");
  // Which legalCaseId's status is being updated.
  const [updatingCaseStatusId, setUpdatingCaseStatusId] = useState("");
  // Which legalCaseId is having its PDF generated.
  const [generatingDocId, setGeneratingDocId] = useState("");
  // Which legalCaseId document is being opened (signed-URL fetch in flight).
  const [openingDocId, setOpeningDocId] = useState("");

  /**
   * Controls visibility of the emergency contacts modal on the intercept screen.
   * Declared here (not inside the early-return branch) to satisfy the rules of hooks —
   * all hooks must be called unconditionally before any conditional render.
   */
  const [showEmergencyContacts, setShowEmergencyContacts] = useState(false);
  const [requestScope, setRequestScope] = useState("BOTH");
  const [requestReasonText, setRequestReasonText] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestCancellingId, setRequestCancellingId] = useState("");

  async function loadReports() {
    setLoading(true);
    setErrorMessage("");

    try {
      // Backend scopes returned rows by caller role + assignment relations.
      const data = await getReports();
      setReports(data.reports || []);
      // Initialize status map for controlled select inputs
      const statusMap = {};
      (data.reports || []).forEach(r => { statusMap[r.reportId] = r.reportStatus; });
      setReportStatusMap(statusMap);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Skip the API call entirely for unauthenticated visitors — they see the
    // intercept screen and there are no reports to load for them.
    if (!getToken()) return;

    const timerId = window.setTimeout(() => {
      void loadReports();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    // Reassignment requests only exist for authenticated survivors.
    if (!getToken()) return;
    if (!canCreate) return;

    async function loadReassignmentRequests() {
      try {
        const data = await fetchMyReassignmentRequests();
        setReassignmentRequests(data.requests || []);
      } catch {
        // Keep reporting UI usable even if reassignment request history fails.
      }
    }

    loadReassignmentRequests();
  }, [canCreate]);

  /**
   * Closes the emergency contacts modal when the user presses Escape.
   * Only attaches the listener while the modal is open to avoid unnecessary overhead.
   */
  useEffect(() => {
    if (!showEmergencyContacts) return;

    function handleEscape(event) {
      if (event.key === "Escape") setShowEmergencyContacts(false);
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showEmergencyContacts]);

  /**
   * Emergency intercept screen — shown instead of the report form when the visitor
   * has no auth token. Provides two explicit paths:
   *   1. Create Account — proceeds to registration then reporting.
   *   2. View Emergency Contacts — surfaces crisis numbers immediately without sign-up.
   *
   * This screen is a pure frontend concern; the backend already returns emergency
   * contacts in the 401 body from report creation, but the intercept avoids making
   * that round-trip at all.
   */
  const isAuthenticated = Boolean(getToken());

  if (!isAuthenticated) {
    return (
      <main className="library-page">
        {/* Centred intercept card with headline, actions, and sign-in escape hatch */}
        <section className="emergency-intercept" aria-label="Account required to report">
          <p className="eyebrow">Incident reporting</p>
          <h1>You need an account to report an incident</h1>
          <p className="emergency-intercept-lead">
            Creating an account takes a few minutes and keeps your report confidential and
            secure. If you need immediate help, emergency contacts are available below.
          </p>

          <div className="emergency-intercept-actions">
            {/* Primary CTA — creating an account is the expected happy path */}
            <button
              type="button"
              className="primary-btn"
              onClick={() => onNavigate("/join")}
            >
              Create Account
            </button>

            {/* Safety escape hatch — no account required to see crisis numbers */}
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowEmergencyContacts(true)}
            >
              View Emergency Contacts
            </button>
          </div>

          {/* Returning users can reach the sign-in form without scanning for a link */}
          <button
            type="button"
            className="link-btn"
            onClick={() => onNavigate("/join")}
          >
            I already have an account — Sign In
          </button>
        </section>

        {/* Emergency contacts modal — rendered outside the intercept section so it
            sits above everything in the stacking context */}
        {showEmergencyContacts && (
          <div
            className="emergency-contacts-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Emergency contacts"
            // Close when clicking the translucent backdrop (not the modal card itself)
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowEmergencyContacts(false);
            }}
          >
            <div className="emergency-contacts-modal">
              <div className="emergency-contacts-header">
                <h2>Emergency Contacts</h2>
                <p>
                  If you are in immediate danger, contact one of the services below. These
                  lines are free and available 24 hours a day.
                </p>
              </div>

              {/* Three Kenyan crisis contact numbers from the national GBV support network */}
              <ul className="emergency-contact-list" aria-label="Crisis contact numbers">
                <li className="emergency-contact-card">
                  <strong>Police</strong>
                  <span><a href="tel:999">999</a> / <a href="tel:112">112</a></span>
                </li>
                <li className="emergency-contact-card">
                  <strong>Childline Kenya</strong>
                  <span><a href="tel:116">116</a></span>
                </li>
                <li className="emergency-contact-card">
                  <strong>National GBV Hotline</strong>
                  <span><a href="tel:1195">1195</a></span>
                </li>
              </ul>

              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowEmergencyContacts(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  async function refreshMyReassignmentRequests() {
    if (!canCreate) return;
    const data = await fetchMyReassignmentRequests();
    setReassignmentRequests(data.requests || []);
  }

  async function handleSubmitReassignmentRequest(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!requestReasonText.trim()) {
      setErrorMessage("Please provide a reason for the reassignment request.");
      return;
    }

    setRequestSubmitting(true);

    try {
      await submitMyReassignmentRequest({
        requestedScope: requestScope,
        requestReasonText: requestReasonText.trim()
      });

      setRequestReasonText("");
      setRequestScope("BOTH");
      setSuccessMessage("Your reassignment request has been submitted.");
      await refreshMyReassignmentRequests();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not submit reassignment request.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function handleCancelReassignmentRequest(requestId) {
    setRequestCancellingId(requestId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await cancelReassignmentRequest(requestId);
      setSuccessMessage("Reassignment request cancelled.");
      await refreshMyReassignmentRequests();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not cancel reassignment request.");
    } finally {
      setRequestCancellingId("");
    }
  }

  async function handleCreateReport(event) {
    event.preventDefault();

    if (!category.trim() || !description.trim()) {
      setErrorMessage("Category and description are required.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await createReport({
        category: category.trim(),
        severityLevel,
        description: description.trim(),
        location: location.trim(),
        date: incidentDate || undefined
      });

      setCategory("");
      setSeverityLevel("MEDIUM");
      setDescription("");
      setLocation("");
      setIncidentDate("");
      setSuccessMessage("Report submitted successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusUpdate(reportId, reportStatus) {
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // survivorConsent=true keeps escalation path valid when legal escalation
      // is selected; backend still enforces exact transition constraints.
      await updateReportStatus(reportId, reportStatus, true);
      setSuccessMessage("Report status updated.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update report status.");
    }
  }

  async function handleWithdraw(reportId) {
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await withdrawReport(reportId);
      setSuccessMessage("Report withdrawn.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not withdraw report.");
    }
  }

  async function handleEvidenceUpload(reportId) {
    const file = selectedEvidenceByReport[reportId];
    if (!file) {
      setErrorMessage("Select a file before uploading evidence.");
      return;
    }

    setUploadingEvidenceFor(reportId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await uploadEvidence(reportId, file);
      setSelectedEvidenceByReport((current) => {
        const next = { ...current };
        delete next[reportId];
        return next;
      });
      setSuccessMessage("Evidence uploaded successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not upload evidence.");
    } finally {
      setUploadingEvidenceFor("");
    }
  }

  function startEdit(report) {
    setEditingReportId(report.reportId);
    setEditingPayload({
      category: report.category || "",
      severityLevel: report.severityLevel || "MEDIUM",
      description: report.description || "",
      location: report.location || "",
      date: report.date || ""
    });
    setErrorMessage("");
    setSuccessMessage("");
  }

  function cancelEdit() {
    setEditingReportId("");
    setSavingEdit(false);
  }

  async function handleSaveEdit() {
    if (!editingReportId) return;

    if (!editingPayload.category.trim() || !editingPayload.description.trim()) {
      setErrorMessage("Category and description are required.");
      return;
    }

    setSavingEdit(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await updateOwnReport(editingReportId, {
        category: editingPayload.category.trim(),
        severityLevel: editingPayload.severityLevel,
        description: editingPayload.description.trim(),
        location: editingPayload.location.trim(),
        date: editingPayload.date || undefined
      });
      setSuccessMessage("Report updated.");
      cancelEdit();
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update report.");
    } finally {
      setSavingEdit(false);
    }
  }

  function handleDeleteClick(reportId) {
    setDeleteConfirmId(reportId);
  }

  async function handleDeleteConfirm() {
    const reportId = deleteConfirmId;
    setDeleteConfirmId("");
    setDeletingReportId(reportId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteOwnReport(reportId);
      if (editingReportId === reportId) {
        cancelEdit();
      }
      setSuccessMessage("Report deleted.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not delete report.");
    } finally {
      setDeletingReportId("");
    }
  }

  function handleDeleteCancel() {
    setDeleteConfirmId("");
  }

  async function handleOpenEvidence(reportId, evidenceId) {
    setOpeningEvidenceId(evidenceId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // Fetch a short-lived signed URL and open it right away.
      const data = await getEvidenceAccessUrl(reportId, evidenceId);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not open evidence file.");
    } finally {
      setOpeningEvidenceId("");
    }
  }

  // ── Legal case drafting handlers ──────────────────────────────────────────

  /**
   * Initialises local draft state from a report's legalCase object when
   * legal counsel expands the drafting panel. Does not persist anything yet.
   *
   * @param {object} legalCase - The legalCase object from the report API response.
   */
  function initLegalDraft(legalCase) {
    if (!legalCase?.legalCaseId) return;
    // Only initialise once; subsequent edits are maintained locally.
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
  }

  /**
   * Updates a single draft field in local state.
   *
   * @param {string} legalCaseId
   * @param {string} field - One of the four authoring field names.
   * @param {string} value
   */
  function handleLegalDraftChange(legalCaseId, field, value) {
    setLegalDraftByCase((prev) => ({
      ...prev,
      [legalCaseId]: { ...(prev[legalCaseId] || {}), [field]: value }
    }));
  }

  /**
   * Persists the current local draft state for a case to the backend.
   *
   * @param {string} legalCaseId
   */
  async function handleSaveLegalDraft(legalCaseId) {
    setSavingDraftId(legalCaseId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await saveLegalCaseDraft(legalCaseId, legalDraftByCase[legalCaseId] || {});
      setSuccessMessage("Legal case draft saved.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not save legal case draft.");
    } finally {
      setSavingDraftId("");
    }
  }

  /**
   * Advances the legal case to a new lifecycle status.
   *
   * @param {string} legalCaseId
   * @param {string} nextStatus - Target case status.
   */
  async function handleUpdateCaseStatus(legalCaseId, nextStatus) {
    setUpdatingCaseStatusId(legalCaseId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await updateLegalCaseStatus(legalCaseId, nextStatus);
      setSuccessMessage(`Case status updated to ${nextStatus}.`);
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update case status.");
    } finally {
      setUpdatingCaseStatusId("");
    }
  }

  /**
   * Triggers server-side PDF generation from the current draft and refreshes
   * the report list so the new documentGeneratedAt timestamp is visible.
   *
   * @param {string} legalCaseId
   */
  async function handleGenerateDocument(legalCaseId) {
    setGeneratingDocId(legalCaseId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await generateLegalCaseDocument(legalCaseId);
      setSuccessMessage("Legal case document generated successfully.");
      await loadReports();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not generate legal case document.");
    } finally {
      setGeneratingDocId("");
    }
  }

  /**
   * Fetches a short-lived signed URL for the legal case PDF and opens it.
   * Mirrors handleOpenEvidence — the URL expires after ~5 minutes.
   *
   * @param {string} legalCaseId
   */
  async function handleOpenLegalDocument(legalCaseId) {
    setOpeningDocId(legalCaseId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const data = await getLegalCaseDocumentUrl(legalCaseId);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not open legal case document.");
    } finally {
      setOpeningDocId("");
    }
  }

  return (
    <main className="library-page">
      <section className="library-intro">
        <div>
          <p className="eyebrow">Incident reporting</p>
          <h1>Confidential reporting and follow-up</h1>
          <p>
            Signed-in users can review report progress. Survivors can submit new reports, and assigned staff can
            update report status.
          </p>
        </div>
        <div className="library-count">
          <strong>{reports.length}</strong>
          <span>{reports.length === 1 ? "report" : "reports"}</span>
        </div>
      </section>

      {errorMessage && <p role="alert" className="status-message warning">{errorMessage}</p>}
      {successMessage && <p className="status-message">{successMessage}</p>}

      {canCreate && (
        <section className="library-toolbar" aria-label="Create report form">
          <form className="report-form" onSubmit={handleCreateReport}>
            <label htmlFor="report-category">
              Category
              <input
                id="report-category"
                type="text"
                placeholder="e.g. domestic_violence"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>

            <label htmlFor="report-severity">
              Severity
              <select
                id="report-severity"
                value={severityLevel}
                onChange={(event) => setSeverityLevel(event.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>

            <label htmlFor="report-description">
              Description
              <textarea
                id="report-description"
                rows={4}
                placeholder="Describe what happened"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label htmlFor="report-location">
              Location
              <input
                id="report-location"
                type="text"
                placeholder="Incident location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>

            <label htmlFor="report-date">
              Incident date
              <input
                id="report-date"
                type="date"
                value={incidentDate}
                onChange={(event) => setIncidentDate(event.target.value)}
              />
            </label>

            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Report"}
            </button>
          </form>
        </section>
      )}

      {canCreate && (
        <section className="library-toolbar" aria-label="Request staff reassignment">
          <form className="report-form" onSubmit={handleSubmitReassignmentRequest}>
            <h2>Request Staff Reassignment</h2>
            <p>
              If you need a different support staff assignment, submit a request and the NGO team will review it.
            </p>

            <label htmlFor="request-scope">
              Requested change
              <select
                id="request-scope"
                value={requestScope}
                onChange={(event) => setRequestScope(event.target.value)}
              >
                <option value="BOTH">Counsellor and Legal Counsel</option>
                <option value="COUNSELLOR">Counsellor only</option>
                <option value="LEGAL_COUNSEL">Legal Counsel only</option>
              </select>
            </label>

            <label htmlFor="request-reason">
              Reason
              <textarea
                id="request-reason"
                rows={3}
                placeholder="Describe why reassignment would improve your support."
                value={requestReasonText}
                onChange={(event) => setRequestReasonText(event.target.value)}
              />
            </label>

            <button type="submit" className="primary-btn" disabled={requestSubmitting}>
              {requestSubmitting ? "Submitting..." : "Submit Reassignment Request"}
            </button>
          </form>

          <div className="admin-table-wrap" style={{ marginTop: "1rem" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Review Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reassignmentRequests.map((request) => (
                  <tr key={request.requestId}>
                    <td>{request.requestTimestamp ? new Date(request.requestTimestamp).toLocaleString() : "-"}</td>
                    <td>{formatStatus(request.requestedScope)}</td>
                    <td>{formatStatus(request.requestStatus)}</td>
                    <td>{request.ngoAdminReviewNote || "-"}</td>
                    <td>
                      {request.requestStatus === "PENDING" ? (
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => handleCancelReassignmentRequest(request.requestId)}
                          disabled={requestCancellingId === request.requestId}
                        >
                          {requestCancellingId === request.requestId ? "Cancelling..." : "Cancel"}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reassignmentRequests.length === 0 && (
              <p className="admin-empty" style={{ marginTop: "0.6rem" }}>
                No reassignment requests submitted yet.
              </p>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <p className="status-message">Loading reports...</p>
      ) : reports.length === 0 ? (
        <section className="empty-state">
          <h2>No reports yet</h2>
          <p>Create a report to begin tracking support progress.</p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate("/join")}>
            Go to account page
          </button>
        </section>
      ) : (
        <section className="resource-grid" aria-label="Incident reports list">
          {reports.map((report) => (
            <article className="resource-tile" key={report.reportId}>
              <div>
                <span className="resource-category">{formatStatus(report.reportStatus)}</span>
                <h2>{report.category}</h2>
                <p><strong>Report ID:</strong> {report.reportId}</p>
                <p><strong>Submitted:</strong> {report.createdAt ? new Date(report.createdAt).toLocaleString() : "-"}</p>
                <p>{report.description}</p>
                <p><strong>Severity:</strong> {report.severityLevel}</p>
                <p><strong>Location:</strong> {report.location || "Not provided"}</p>
                <p><strong>Date:</strong> {report.date || "Not provided"}</p>
                {report.legalCase && role !== "LEGAL_COUNSEL" && (
                  /* Read-only summary for non-legal-counsel roles */
                  <p>
                    <strong>Legal case:</strong> {report.legalCase.caseStatus}
                    {report.legalCase.legalCaseId ? ` (${report.legalCase.legalCaseId})` : ""}
                  </p>
                )}

                {report.legalCase && role === "LEGAL_COUNSEL" && (
                  /* Full drafting panel — visible only to the assigned legal counsel */
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

                    {/* Four structured authoring fields */}
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

                    {/* Drafting actions */}
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

                    {/* Case lifecycle control */}
                    {(() => {
                      const NEXT_STATUSES = {
                        OPEN: ["UNDER_INVESTIGATION"],
                        UNDER_INVESTIGATION: ["READY_FOR_SUBMISSION"],
                        READY_FOR_SUBMISSION: ["SUBMITTED"],
                        SUBMITTED: ["CLOSED"],
                        CLOSED: []
                      };
                      const nextOptions = NEXT_STATUSES[report.legalCase.caseStatus] || [];
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
                {canCreate && report.reportStatus === "SUBMITTED" && editingReportId !== report.reportId && (
                  <button type="button" className="secondary-btn" onClick={() => startEdit(report)}>
                    Edit Draft
                  </button>
                )}

                {canCreate && editingReportId === report.reportId && (
                  <div className="inline-edit-block">
                    <label htmlFor={`edit-category-${report.reportId}`}>
                      Category
                      <input
                        id={`edit-category-${report.reportId}`}
                        type="text"
                        value={editingPayload.category}
                        onChange={(event) => setEditingPayload((current) => ({ ...current, category: event.target.value }))}
                      />
                    </label>

                    <label htmlFor={`edit-severity-${report.reportId}`}>
                      Severity
                      <select
                        id={`edit-severity-${report.reportId}`}
                        value={editingPayload.severityLevel}
                        onChange={(event) => setEditingPayload((current) => ({ ...current, severityLevel: event.target.value }))}
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </label>

                    <label htmlFor={`edit-description-${report.reportId}`}>
                      Description
                      <textarea
                        id={`edit-description-${report.reportId}`}
                        rows={3}
                        value={editingPayload.description}
                        onChange={(event) =>
                          setEditingPayload((current) => ({ ...current, description: event.target.value }))
                        }
                      />
                    </label>

                    <label htmlFor={`edit-location-${report.reportId}`}>
                      Location
                      <input
                        id={`edit-location-${report.reportId}`}
                        type="text"
                        value={editingPayload.location}
                        onChange={(event) => setEditingPayload((current) => ({ ...current, location: event.target.value }))}
                      />
                    </label>

                    <label htmlFor={`edit-date-${report.reportId}`}>
                      Incident date
                      <input
                        id={`edit-date-${report.reportId}`}
                        type="date"
                        value={editingPayload.date}
                        onChange={(event) => setEditingPayload((current) => ({ ...current, date: event.target.value }))}
                      />
                    </label>

                    <div className="inline-edit-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                      >
                        {savingEdit ? "Saving..." : "Save Changes"}
                      </button>
                      <button type="button" className="secondary-btn" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {canCreate && report.reportStatus !== "WITHDRAWN" && (
                  <div className="evidence-upload-block">
                    <label htmlFor={`evidence-${report.reportId}`}>Add evidence</label>
                    <input
                      id={`evidence-${report.reportId}`}
                      type="file"
                      accept="image/*,application/pdf,audio/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;

                        if (file && file.size > 15 * 1024 * 1024) {
                          // Keep client-side limit aligned with Multer backend limit.
                          setErrorMessage("Evidence file must be 15MB or smaller.");
                          return;
                        }

                        setSelectedEvidenceByReport((current) => ({
                          ...current,
                          [report.reportId]: file
                        }));
                      }}
                    />
                    <small>Accepted: images, PDF, audio. Max size: 15MB.</small>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleEvidenceUpload(report.reportId)}
                      disabled={uploadingEvidenceFor === report.reportId || !selectedEvidenceByReport[report.reportId]}
                    >
                      {uploadingEvidenceFor === report.reportId ? "Uploading..." : "Upload Evidence"}
                    </button>
                  </div>
                )}

                {(report.evidence || []).length > 0 && (
                  <div className="evidence-list">
                    <strong>Evidence files</strong>
                    {(report.evidence || []).map((evidence) => (
                      <button
                        type="button"
                        key={evidence.evidenceId}
                        className="footer-link"
                        onClick={() => handleOpenEvidence(report.reportId, evidence.evidenceId)}
                        disabled={openingEvidenceId === evidence.evidenceId}
                      >
                        {openingEvidenceId === evidence.evidenceId
                          ? "Opening..."
                          : evidence.originalFileName || `${evidence.fileType} evidence`}
                      </button>
                    ))}
                  </div>
                )}

                {canCreate && report.reportStatus !== "WITHDRAWN" && (
                  <button type="button" className="secondary-btn" onClick={() => handleWithdraw(report.reportId)}>
                    Withdraw
                  </button>
                )}

                {canCreate && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleDeleteClick(report.reportId)}
                    disabled={deletingReportId === report.reportId}
                  >
                    {deletingReportId === report.reportId ? "Deleting..." : "Delete Permanently"}
                  </button>
                )}

                {canUpdateStatus && (
                  <label className="status-select-label" htmlFor={`status-${report.reportId}`}>
                    Update status
                    {/* UI shows full enum; backend is the final authority on role and transition validity. */}
                    <select
                      id={`status-${report.reportId}`}
                      value={reportStatusMap[report.reportId] ?? report.reportStatus}
                      onChange={(event) => {
                        setReportStatusMap(m => ({...m, [report.reportId]: event.target.value}));
                        handleStatusUpdate(report.reportId, event.target.value);
                      }}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {formatStatus(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Delete Report Permanently"
        message="This report will be permanently deleted and cannot be recovered. Are you sure?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        variant="danger"
      />
    </main>
  );
}

export default ReportingPage;
