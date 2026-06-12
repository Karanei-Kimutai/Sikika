import { useEffect, useMemo, useState } from "react";
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
  const token = localStorage.getItem("authToken");
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
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");
  const [reassignmentRequests, setReassignmentRequests] = useState([]);

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
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Skip the API call entirely for unauthenticated visitors — they see the
    // intercept screen and there are no reports to load for them.
    if (!localStorage.getItem("authToken")) return;

    const timerId = window.setTimeout(() => {
      void loadReports();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    // Reassignment requests only exist for authenticated survivors.
    if (!localStorage.getItem("authToken")) return;
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
  const isAuthenticated = Boolean(localStorage.getItem("authToken"));

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
                  <span>999 / 112</span>
                </li>
                <li className="emergency-contact-card">
                  <strong>Childline Kenya</strong>
                  <span>116</span>
                </li>
                <li className="emergency-contact-card">
                  <strong>National GBV Hotline</strong>
                  <span>1195</span>
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

  async function handleDelete(reportId) {
    const confirmed = window.confirm("Delete this report permanently?");
    if (!confirmed) return;

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

      {errorMessage && <p className="status-message warning">{errorMessage}</p>}
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
                {report.legalCase && (
                  <p>
                    <strong>Legal case:</strong> {report.legalCase.caseStatus}
                    {report.legalCase.legalCaseId ? ` (${report.legalCase.legalCaseId})` : ""}
                  </p>
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
                    onClick={() => handleDelete(report.reportId)}
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
                      defaultValue={report.reportStatus}
                      onChange={(event) => handleStatusUpdate(report.reportId, event.target.value)}
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
    </main>
  );
}

export default ReportingPage;
