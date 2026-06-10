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
  const role = useMemo(decodeTokenRole, []);
  const canCreate = role === "SURVIVOR";
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

  async function loadReports() {
    setLoading(true);
    setErrorMessage("");

    try {
      const data = await getReports();
      setReports(data.reports || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

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
                <p>{report.description}</p>
                <p><strong>Severity:</strong> {report.severityLevel}</p>
                <p><strong>Location:</strong> {report.location || "Not provided"}</p>
                <p><strong>Date:</strong> {report.date || "Not provided"}</p>
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
