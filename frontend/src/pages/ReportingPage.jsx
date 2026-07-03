import { useEffect, useMemo, useState } from "react";
import { getToken } from "../utils/auth";
import { getReports } from "../services/reports";
import UnauthReportIntercept from "./reporting/UnauthReportIntercept";
import SurvivorReportView from "./reporting/SurvivorReportView";
import StaffReportView from "./reporting/StaffReportView";
import LegalCounselView from "./reporting/LegalCounselView";

/**
 * Decodes the JWT stored in sessionStorage and returns the role claim.
 * @returns {string} Uppercased role string, or "" when unauthenticated.
 */
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

/**
 * Reads /reports?reportId=<id> deep-link parameter, e.g. arriving here via a
 * clicked report-update notification — lets the sub-views scroll to and
 * highlight that specific report once the list loads.
 * @returns {string}
 */
function readHighlightReportIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return String(params.get("reportId") || "").trim();
  } catch {
    return "";
  }
}

/**
 * ReportingPage
 * -------------
 * Thin role-router for the /reports path. Responsibilities:
 *  - Redirect unauthenticated visitors to UnauthReportIntercept
 *  - Load reports once on mount (backend scopes rows by caller role)
 *  - Render the correct role-specific view (Survivor / Staff / LegalCounsel)
 *  - Own shared feedback state (errorMessage, successMessage) passed to sub-views
 *
 * @param {{ onNavigate: Function }} props
 */
function ReportingPage({ onNavigate }) {
  const isAuthenticated = Boolean(getToken());
  const role = useMemo(() => decodeTokenRole(), []);
  const highlightReportId = useMemo(() => readHighlightReportIdFromUrl(), []);

  const [reports, setReports] = useState([]);
  // Start loading=false for unauthenticated visitors (they see the intercept screen).
  const [loading, setLoading] = useState(isAuthenticated);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  /**
   * Fetches the report list. Called on mount and after any mutation by sub-views.
   * Backend scopes results to the caller's role and assignment relations.
   */
  async function loadReports() {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getReports();
      setReports(data.reports || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "No reports available.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Skip the API call for unauthenticated visitors.
    if (!isAuthenticated) return;
    const timerId = window.setTimeout(() => { void loadReports(); }, 0);
    return () => window.clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAuthenticated) {
    return <UnauthReportIntercept onNavigate={onNavigate} />;
  }

  const sharedProps = { reports, loading, loadReports, setErrorMessage, setSuccessMessage, highlightReportId, role };

  const renderView = () => {
    if (role === "SURVIVOR") return <SurvivorReportView {...sharedProps} onNavigate={onNavigate} />;
    if (role === "LEGAL_COUNSEL") return <LegalCounselView {...sharedProps} />;
    // COUNSELLOR and NGO_ADMIN
    if (["COUNSELLOR", "NGO_ADMIN"].includes(role)) return <StaffReportView {...sharedProps} />;
    // Fallback for unrecognised roles — show read-only staff view
    return <StaffReportView {...sharedProps} />;
  };

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

      {renderView()}
    </main>
  );
}

export default ReportingPage;
