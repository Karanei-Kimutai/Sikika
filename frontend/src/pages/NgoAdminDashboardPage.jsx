import { useEffect, useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import AdminWorkspace from "@/components/AdminWorkspace";
import axios from "axios";
import {
  getNgoAdminDashboard,
  reviewModerationReport,
  runAdminSearch,
  createNgoResource,
  updateNgoResource,
  reassignSurvivorCase,
  createNgoStaffAccount,
  getNgoReassignmentRequests,
  reviewNgoReassignmentRequest,
  getUssdCallbackRequests,
  updateUssdCallbackRequest,
  updateNgoStaffStatus,
  banUser,
  unbanUser,
  listBannedUsers,
  setMaintenanceMode as setMaintenanceModeApi,
  getReassignmentSuggestions
} from "@/services/admin";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
import { getEvidenceAccessUrl, getReportById } from "@/services/reports";
import { prettifyLabel, formatDate, formatNumber, priorityClass } from "./ngo-admin/helpers";
import CommandCenterSection from "./ngo-admin/CommandCenterSection";
import TeamCapacitySection from "./ngo-admin/TeamCapacitySection";
import ModerationDeskSection from "./ngo-admin/ModerationDeskSection";
import UssdCallbacksSection from "./ngo-admin/UssdCallbacksSection";
import BanUserModal from "./ngo-admin/BanUserModal";
// BannedUsersSection is imported and rendered inside ModerationDeskSection's Banned Users tab.

/**
 * NGO Admin Dashboard
 * -------------------
 * Consolidates all NGO-operations views into one route-driven workspace.
 * Each major section is extracted to its own component under ./ngo-admin/.
 *
 * Sections rendered inline (not extracted):
 * - case-triage, reports, community-chat, resources
 *
 * State and async handlers all live here and are passed down as props.
 */

const ngoMenu = [
  { id: "command-center", label: "Command Center", description: "Live KPIs and movement trends" },
  { id: "case-triage", label: "Case Triage", description: "Urgent case routing and alerts" },
  { id: "reports", label: "Reports", description: "All submitted reports and statuses" },
  { id: "community-chat", label: "Community Chat", description: "Room safety and support conversations" },
  { id: "team-capacity", label: "Team Capacity", description: "Counsellor and legal workload" },
  { id: "moderation-desk", label: "Moderation Desk", description: "Community safety decisions" },
  { id: "resources", label: "Resources", description: "Resource center and case intelligence" },
  { id: "ussd-callbacks", label: "USSD Callbacks", description: "Callback requests from USSD callers" }
  // Note: Banned Users is accessible via the Moderation Desk → Banned Users tab.
  // It is not listed here because the AdminWorkspace sidebar is disabled (showSidebar=false)
  // and the top nav does not expose it as a standalone section.
];

function NgoAdminDashboardPage({ onNavigate, onSignOut, initialSection = "command-center" }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeSection, setActiveSection] = useState("command-center");
  const [editingResourceId, setEditingResourceId] = useState("");
  const [resourceForm, setResourceForm] = useState({
    title: "",
    category: "",
    fileUrl: "",
    description: ""
  });
  const [assignmentForm, setAssignmentForm] = useState({
    survivorId: "",
    counsellorId: "",
    legalCounselId: "",
    reason: ""
  });
  // Staff onboarding state is intentionally colocated with team-capacity controls
  // because both concern day-to-day NGO workforce operations.
  const [staffForm, setStaffForm] = useState({
    phoneNumber: "",
    password: "",
    role: "COUNSELLOR",
    specialization: "",
    availabilityStatus: "AVAILABLE"
  });
  const [reportFilters, setReportFilters] = useState({
    status: "ALL",
    category: "ALL",
    severity: "ALL",
    query: ""
  });
  const [selectedCaseReportId, setSelectedCaseReportId] = useState("");
  const [selectedReportDetails, setSelectedReportDetails] = useState(null);
  const [loadingReportDetailsFor, setLoadingReportDetailsFor] = useState("");
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");
  const [reassignmentRequests, setReassignmentRequests] = useState([]);
  const [reassignmentFilter, setReassignmentFilter] = useState("PENDING");
  const [reviewingRequestId, setReviewingRequestId] = useState("");
  const [selectedModerationRow, setSelectedModerationRow] = useState(null);
  const [ussdCallbacks, setUssdCallbacks] = useState([]);
  const [updatingCallbackId, setUpdatingCallbackId] = useState("");

  // ── Banned users registry state ──────────────────────────────────────────
  const [bannedUsers, setBannedUsers] = useState([]);
  const [bannedUsersFilter, setBannedUsersFilter] = useState("");
  const [bannedUsersLoading, setBannedUsersLoading] = useState(false);
  const [liftingBanId, setLiftingBanId] = useState(null);

  // ── Maintenance mode state ────────────────────────────────────────────────
  // The one System-Admin capability retained after that role's removal —
  // folded into the NGO Admin dashboard and re-gated to NGO_ADMIN on the backend.
  const [maintenanceMode, setMaintenanceModeState] = useState({ enabled: false, reason: null, expectedUntil: null });
  const [maintenanceToggling, setMaintenanceToggling] = useState(false);

  async function refreshMaintenanceStatus() {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/system/public-status`);
      setMaintenanceModeState(response.data?.maintenanceMode || { enabled: false, reason: null, expectedUntil: null });
    } catch {
      // Non-fatal — the toggle control simply reflects stale state until the next refresh.
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refreshMaintenanceStatus();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  async function handleToggleMaintenanceMode() {
    setErrorMessage("");
    setSuccessMessage("");
    setMaintenanceToggling(true);
    try {
      const nextEnabled = !maintenanceMode.enabled;
      const result = await setMaintenanceModeApi(nextEnabled);
      setMaintenanceModeState(result.maintenanceMode);
      setSuccessMessage(`Maintenance mode ${nextEnabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to update maintenance mode.");
    } finally {
      setMaintenanceToggling(false);
    }
  }

  // ── Staff active/inactive toggle state ───────────────────────────────────
  /** In-flight userId for the active/inactive flip (drives per-row loading state). */
  const [togglingStaffId, setTogglingStaffId] = useState(null);

  /**
   * handleToggleStaffActive
   * -----------------------
   * Flips a counsellor/legal-counsel account between ACTIVE ("Active") and
   * SUSPENDED ("Inactive"). This is the operational pause/resume control;
   * it intentionally does not interact with the ban workflow.
   *
   * @param {string} userId     - UUID of the staff account to toggle.
   * @param {"ACTIVE"|"SUSPENDED"} nextStatus - Target status to set.
   * @param {string} label      - Human-readable label for the success banner.
   */
  async function handleToggleStaffActive(userId, nextStatus, label) {
    setErrorMessage("");
    setSuccessMessage("");
    setTogglingStaffId(userId);
    try {
      await updateNgoStaffStatus(userId, nextStatus);
      const verb = nextStatus === "SUSPENDED" ? "set to inactive" : "reactivated";
      setSuccessMessage(`${label} ${verb} successfully.`);
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to update staff status.");
    } finally {
      setTogglingStaffId(null);
    }
  }

  // ── Ban workflow state ────────────────────────────────────────────────────
  /**
   * banModal: null (closed) or { userId, label, reportId? }
   *
   * reportId is present when the ban originates from the Moderation Desk —
   * submit then calls reviewModerationReport (ban_user action) so the underlying
   * report is resolved atomically with the ban.
   * When reportId is absent (Staff Directory path), submit calls banUser directly.
   */
  const [banModal, setBanModal] = useState(null);
  const [banForm, setBanForm] = useState({ reason: "", expiresAt: "" });
  const [banLoading, setBanLoading] = useState(false);

  /**
   * handleOpenBanModal
   * ------------------
   * Opens the ban reason/expiry modal for a given user.
   *
   * @param {string} userId      - UUID of the user to be banned.
   * @param {string} label       - Human-readable label for the modal heading.
   * @param {string} [reportId]  - If banning from the Moderation Desk, the
   *   contentReportId to resolve atomically. Omit for Staff Directory bans.
   */
  function handleOpenBanModal(userId, label, reportId) {
    setBanForm({ reason: "", expiresAt: "" });
    setBanModal({ userId, label, reportId: reportId || null });
  }

  /**
   * handleSubmitBan
   * ---------------
   * Submits the ban form. Two paths based on origin:
   *
   * - Moderation Desk (banModal.reportId present): calls reviewModerationReport
   *   with action "ban_user" so the harmful-content report is marked APPROVED
   *   (resolved) in the same backend transaction as the ban.
   * - Staff Directory (no reportId): calls banUser directly.
   *
   * On success: reloads the dashboard and shows a success message.
   */
  async function handleSubmitBan(event) {
    event.preventDefault();
    if (!banModal?.userId) return;
    if (!banForm.reason.trim()) {
      setErrorMessage("A ban reason is required.");
      return;
    }

    setBanLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      if (banModal.reportId) {
        // Moderation-desk path: ban + resolve the report atomically.
        await reviewModerationReport(banModal.reportId, "APPROVED", "ban_user", {
          reason: banForm.reason.trim(),
          expiresAt: banForm.expiresAt || null
        });
      } else {
        // Staff-directory path: plain ban, no report to resolve.
        await banUser(banModal.userId, {
          reason: banForm.reason.trim(),
          expiresAt: banForm.expiresAt || null
        });
      }
      setSuccessMessage("User banned successfully.");
      setBanModal(null);
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to apply ban.");
    } finally {
      setBanLoading(false);
    }
  }

  /**
   * handleUnban
   * -----------
   * Directly lifts the ban for a given user (no modal — ban history is visible
   * in the staff directory row or moderation queue row).
   *
   * @param {string} userId - UUID of the user to unban.
   * @param {string} label  - Human-readable label for success message.
   */
  async function handleUnban(userId, label) {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await unbanUser(userId);
      setSuccessMessage(`Ban lifted for ${label}.`);
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to lift ban.");
    }
  }

  /**
   * handleUnbanFromRegistry
   * -----------------------
   * Lifts a ban from the Banned Users registry section and refreshes the list.
   * This path handles survivors and any staff member that may not be visible in
   * the Staff Directory (e.g., deactivated or never fully onboarded).
   *
   * @param {string} userId - UUID of the user to unban.
   * @param {string} label  - Phone number or role label for success message.
   */
  async function handleUnbanFromRegistry(userId, label) {
    setErrorMessage("");
    setSuccessMessage("");
    setLiftingBanId(userId);
    try {
      await unbanUser(userId);
      setSuccessMessage(`Ban lifted for ${label}.`);
      // Refresh the banned list in place (no full dashboard reload needed).
      const data = await listBannedUsers(bannedUsersFilter || undefined);
      setBannedUsers(data.bannedUsers || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to lift ban.");
    } finally {
      setLiftingBanId(null);
    }
  }

  function resetReportFilters() {
    setReportFilters({
      status: "ALL",
      category: "ALL",
      severity: "ALL",
      query: ""
    });
  }

  async function loadDashboard() {
    // Single backend aggregate call keeps section metrics consistent by timestamp.
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getNgoAdminDashboard();
      setDashboard(data);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to load NGO admin workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial load only; explicit refreshes happen after mutation actions.
    const timerId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (activeSection !== "ussd-callbacks") return;

    async function loadUssdCallbacks() {
      try {
        const data = await getUssdCallbackRequests();
        setUssdCallbacks(data.requests || []);
      } catch {
        // Non-fatal — table shows empty state if fetch fails.
      }
    }

    loadUssdCallbacks();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "team-capacity") return;

    async function loadReassignmentRequests() {
      try {
        const data = await getNgoReassignmentRequests(reassignmentFilter);
        setReassignmentRequests(data.requests || []);
      } catch {
        // Keep broader dashboard available even if request queue fails.
      }
    }

    loadReassignmentRequests();
  }, [activeSection, reassignmentFilter]);

  /**
   * loadBannedUsersData
   * -------------------
   * Fetches the banned-users list and populates state. Extracted so it can be
   * called both from the tab-open callback (first open) and from the filter
   * change effect (subsequent filter selections).
   */
  async function loadBannedUsersData() {
    setBannedUsersLoading(true);
    try {
      const data = await listBannedUsers(bannedUsersFilter || undefined);
      setBannedUsers(data.bannedUsers || []);
    } catch {
      setBannedUsers([]);
    } finally {
      setBannedUsersLoading(false);
    }
  }

  /**
   * Re-fetch the banned list whenever the filter changes while the Moderation
   * Desk section is active. Wraps loadBannedUsersData in an inner async function
   * per the ESLint react-hooks/set-state-in-effect convention (same pattern used
   * by other data-loading effects in this file).
   *
   * The initial load on first tab-open is triggered separately via the
   * onBannedUsersTabOpen callback passed to ModerationDeskSection.
   */
  useEffect(() => {
    if (activeSection !== "moderation-desk") return;
    async function doRefresh() {
      await loadBannedUsersData();
    }
    doRefresh();
  }, [bannedUsersFilter, activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // App route aliases map to section ids through initialSection prop.
    const timerId = window.setTimeout(() => {
      setActiveSection(initialSection);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [initialSection]);

  useEffect(() => {
    if (!assignmentForm.survivorId) return;

    const selected = (dashboard?.survivorAssignments || []).find(
      (survivor) => survivor.survivorId === assignmentForm.survivorId
    );

    if (!selected) return;

    // Prefill with current assignment so reassignment edits are incremental.
    const timerId = window.setTimeout(() => {
      setAssignmentForm((prev) => ({
        ...prev,
        counsellorId: selected.assignedCounsellorId || "",
        legalCounselId: selected.assignedLegalCounselId || ""
      }));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [assignmentForm.survivorId, dashboard]);

  // ── Auto-suggested reassignment ───────────────────────────────────────────
  // Fetches the least-loaded available counsellor/legal-counsel for the
  // selected survivor so the admin sees a recommendation instead of picking
  // blind. Purely advisory — the admin can still pick anyone in the dropdowns.
  const [reassignmentSuggestion, setReassignmentSuggestion] = useState(null);

  useEffect(() => {
    const timerId = window.setTimeout(async () => {
      if (!assignmentForm.survivorId) {
        setReassignmentSuggestion(null);
        return;
      }

      try {
        const result = await getReassignmentSuggestions(assignmentForm.survivorId);
        setReassignmentSuggestion(result);
      } catch {
        setReassignmentSuggestion(null);
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [assignmentForm.survivorId]);

  function applyReassignmentSuggestion() {
    if (!reassignmentSuggestion) return;
    setAssignmentForm((prev) => ({
      ...prev,
      counsellorId: reassignmentSuggestion.suggestedCounsellorId || prev.counsellorId,
      legalCounselId: reassignmentSuggestion.suggestedLegalCounselId || prev.legalCounselId
    }));
  }

  function handleSectionSelect(sectionId) {
    // Some sections route to dedicated product pages instead of rendering in-place.
    if (sectionId === "community-chat") {
      onNavigate("/community");
      return;
    }
    if (sectionId === "resources") {
      onNavigate("/library");
      return;
    }
    setActiveSection(sectionId);
  }

  async function handleSearch(event) {
    event.preventDefault();
    const query = searchTerm.trim();

    if (!query) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setErrorMessage("");

    try {
      // Search endpoint spans users + reports for triage workflows.
      const data = await runAdminSearch(query);
      setSearchResults(data.results || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Global search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handleModerationAction(reportId, action) {
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await reviewModerationReport(reportId, "APPROVED", action);
      setSuccessMessage("Moderation action completed.");
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to apply moderation action.");
    }
  }

  function handleViewReportDetails(reportId) {
    // Toggle behavior: clicking the same row twice closes the popup.
    const value = String(reportId || "");
    if (!value) return;

    if (selectedCaseReportId === value) {
      setSelectedCaseReportId("");
      setSelectedReportDetails(null);
      return;
    }

    setSelectedCaseReportId(value);
    loadReportDetails(value);
  }

  function closeReportDetailsModal() {
    setSelectedCaseReportId("");
    setSelectedReportDetails(null);
    setLoadingReportDetailsFor("");
  }

  async function loadReportDetails(reportId) {
    setLoadingReportDetailsFor(reportId);
    setErrorMessage("");

    try {
      const data = await getReportById(reportId);
      setSelectedReportDetails(data.report || null);
    } catch (error) {
      setSelectedReportDetails(null);
      setErrorMessage(error.response?.data?.error || "Could not load full report details.");
    } finally {
      setLoadingReportDetailsFor("");
    }
  }

  async function handleOpenEvidence(reportId, evidenceId) {
    setOpeningEvidenceId(evidenceId);
    setErrorMessage("");

    try {
      const data = await getEvidenceAccessUrl(reportId, evidenceId);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not open evidence file.");
    } finally {
      setOpeningEvidenceId("");
    }
  }

  function startEditResource(resource) {
    setEditingResourceId(resource.resourceId);
    setResourceForm({
      title: resource.title || "",
      category: resource.category || "",
      fileUrl: resource.fileUrl || "",
      description: resource.description || ""
    });
  }

  async function handleResourceSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const payload = {
      title: resourceForm.title.trim(),
      category: resourceForm.category.trim(),
      fileUrl: resourceForm.fileUrl.trim(),
      description: resourceForm.description.trim()
    };

    if (!payload.title || !payload.category || !payload.fileUrl) {
      setErrorMessage("Resource title, category, and URL are required.");
      return;
    }

    try {
      if (editingResourceId) {
        await updateNgoResource(editingResourceId, payload);
        setSuccessMessage("Resource updated.");
      } else {
        await createNgoResource(payload);
        setSuccessMessage("Resource created.");
      }

      setEditingResourceId("");
      setResourceForm({ title: "", category: "", fileUrl: "", description: "" });
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to save resource.");
    }
  }

  async function handleReassign(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!assignmentForm.survivorId) {
      setErrorMessage("Select a survivor before reassigning.");
      return;
    }

    try {
      await reassignSurvivorCase({
        survivorId: assignmentForm.survivorId,
        counsellorId: assignmentForm.counsellorId || null,
        legalCounselId: assignmentForm.legalCounselId || null,
        reason: assignmentForm.reason.trim() || undefined
      });

      setSuccessMessage("Survivor assignment updated.");
      setAssignmentForm({ survivorId: "", counsellorId: "", legalCounselId: "", reason: "" });
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to reassign survivor.");
    }
  }

  async function handleStaffCreate(event) {
    // Onboarding is performed by NGO admins and creates staff in
    // password_reset_required state for first-login credential rotation.
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const payload = {
      phoneNumber: staffForm.phoneNumber.trim(),
      password: staffForm.password,
      role: staffForm.role,
      specialization: staffForm.specialization.trim(),
      availabilityStatus: staffForm.availabilityStatus
    };

    if (!payload.phoneNumber || !payload.password || !payload.role) {
      setErrorMessage("Phone number, temporary password, and role are required.");
      return;
    }

    try {
      const data = await createNgoStaffAccount(payload);
      setSuccessMessage(data.message || "Staff account created.");
      // Reset only staffing controls after success; keep broader dashboard context.
      setStaffForm({
        phoneNumber: "",
        password: "",
        role: "COUNSELLOR",
        specialization: "",
        availabilityStatus: "AVAILABLE"
      });
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to create staff account.");
    }
  }

  async function refreshReassignmentRequests() {
    const data = await getNgoReassignmentRequests(reassignmentFilter);
    setReassignmentRequests(data.requests || []);
  }

  async function handleReviewReassignmentRequest(requestId, requestStatus) {
    setReviewingRequestId(requestId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await reviewNgoReassignmentRequest(requestId, { requestStatus });
      setSuccessMessage(`Request ${requestStatus.toLowerCase()} successfully.`);
      await Promise.all([loadDashboard(), refreshReassignmentRequests()]);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to review reassignment request.");
    } finally {
      setReviewingRequestId("");
    }
  }

  /**
   * Mark a USSD callback request as COMPLETED or CANCELLED.
   * Refreshes the local list after a successful update.
   *
   * @param {string} requestId
   * @param {'COMPLETED'|'CANCELLED'} status
   */
  async function handleUpdateCallback(requestId, status) {
    setUpdatingCallbackId(requestId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await updateUssdCallbackRequest(requestId, status);
      setSuccessMessage(`Callback request marked as ${status.toLowerCase()}.`);
      const data = await getUssdCallbackRequests();
      setUssdCallbacks(data.requests || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update callback request.");
    } finally {
      setUpdatingCallbackId("");
    }
  }

  // ── Derived values (used by inline sections: reports, case-triage) ────────
  const filteredReports = useMemo(() => {
    const all = dashboard?.recentReports || [];
    return all.filter((report) => {
      const matchesStatus = reportFilters.status === "ALL" || report.currentReportStatus === reportFilters.status;
      const matchesCategory = reportFilters.category === "ALL" || report.incidentCategory === reportFilters.category;
      const matchesSeverity = reportFilters.severity === "ALL" || report.severityLevel === reportFilters.severity;
      const searchValue = reportFilters.query.trim().toLowerCase();
      const matchesQuery = !searchValue
        || String(report.reportId || "").toLowerCase().includes(searchValue)
        || String(report.incidentCategory || "").toLowerCase().includes(searchValue)
        || String(report.currentReportStatus || "").toLowerCase().includes(searchValue);
      return matchesStatus && matchesCategory && matchesSeverity && matchesQuery;
    });
  }, [dashboard, reportFilters]);
  const selectedCaseReport = useMemo(() => {
    if (!selectedCaseReportId) return null;
    return (dashboard?.recentReports || []).find((report) => String(report.reportId) === selectedCaseReportId) || null;
  }, [dashboard, selectedCaseReportId]);
  const reportStatusTabs = useMemo(() => {
    const counts = new Map();
    (dashboard?.recentReports || []).forEach((report) => {
      counts.set(report.currentReportStatus, (counts.get(report.currentReportStatus) || 0) + 1);
    });
    return [
      { value: "ALL", label: "All", count: (dashboard?.recentReports || []).length },
      ...Array.from(counts.entries()).map(([status, count]) => ({ value: status, label: prettifyLabel(status), count }))
    ];
  }, [dashboard]);
  const reportCategoryOptions = useMemo(() => {
    return ["ALL", ...new Set((dashboard?.recentReports || []).map((report) => report.incidentCategory))];
  }, [dashboard]);

  // ── Derived values passed to TeamCapacitySection ──────────────────────────
  const staffLabelById = useMemo(() => {
    const map = new Map();
    [...(dashboard?.staffWorkload?.counsellors || []), ...(dashboard?.staffWorkload?.legalCounsel || [])].forEach((staff) => {
      map.set(staff.id, staff.label);
    });
    return map;
  }, [dashboard]);
  const selectedSurvivor = useMemo(
    () => (dashboard?.survivorAssignments || []).find((item) => item.survivorId === assignmentForm.survivorId) || null,
    [dashboard, assignmentForm.survivorId]
  );
  const teamStats = useMemo(() => {
    const directory = dashboard?.staffDirectory || [];
    const assignments = dashboard?.survivorAssignments || [];

    const availableStaff = directory.filter(
      (staff) => String(staff.availability || "").toUpperCase() === "AVAILABLE"
    ).length;
    const highLoadStaff = directory.filter((staff) => Number(staff.activeCases || 0) >= 6).length;
    const partiallyUnassignedSurvivors = assignments.filter(
      (survivor) => !survivor.assignedCounsellorId || !survivor.assignedLegalCounselId
    ).length;

    return {
      totalStaff: directory.length,
      availableStaff,
      highLoadStaff,
      partiallyUnassignedSurvivors
    };
  }, [dashboard]);

  if (loading) {
    return (
      <main className="admin-workspace ngo" aria-busy="true" aria-label="Loading NGO operations workspace">
        <section className="admin-content-area">
          <div className="skeleton-grid" style={{ padding: '1.5rem' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
          <div style={{ padding: '0 1.5rem' }}>
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" style={{ width: '75%' }} />
          </div>
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="admin-workspace ngo">
        <section className="admin-content-area" style={{ padding: "2rem", maxWidth: "520px" }}>
          <p className="status-message warning" role="alert" style={{ marginBottom: "1rem" }}>
            {errorMessage || "Could not load the NGO workspace. Check that the backend is running."}
          </p>
          <button type="button" className="primary-btn" onClick={loadDashboard}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  const profileRows = [
    { label: "User", value: dashboard.profile?.userId || "NGO Admin" },
    { label: "Department", value: dashboard.profile?.department || "Operations" },
    { label: "Access", value: dashboard.profile?.accessLevel || 1 }
  ];
  const currentNgoSection = ngoMenu.find((item) => item.id === activeSection) || ngoMenu[0];

  return (
    <AdminWorkspace
      roleLabel="NGO Operations Administrator"
      title={currentNgoSection?.label || "NGO Admin"}
      subtitle={currentNgoSection?.description || "NGO operations workspace"}
      profile={profileRows}
      menuItems={ngoMenu}
      activeSection={activeSection}
      onSelectSection={handleSectionSelect}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
      showSidebar={false}
    >
      {errorMessage && <p className="status-message warning" role="alert">{errorMessage}</p>}
      {successMessage && <p className="status-message" role="status">{successMessage}</p>}

      <div className="maintenance-mode-toggle-bar">
        <span>
          {/* ON means the platform is in restricted maintenance access, hence the amber dot. */}
          <span className={`maintenance-dot ${maintenanceMode.enabled ? "maintenance-dot--on" : "maintenance-dot--off"}`} aria-hidden="true" />
          Maintenance Mode: <strong>{maintenanceMode.enabled ? "ON" : "OFF"}</strong>
        </span>
        <button
          type="button"
          className="secondary-btn"
          onClick={handleToggleMaintenanceMode}
          disabled={maintenanceToggling}
          data-testid="ngo-maintenance-toggle"
        >
          {maintenanceToggling
            ? "Updating..."
            : maintenanceMode.enabled ? "Disable Maintenance Mode" : "Enable Maintenance Mode"}
        </button>
      </div>

      {/* ── Extracted sections ────────────────────────────────────────── */}
      {activeSection === "command-center" && (
        <CommandCenterSection
          overview={dashboard.overview || {}}
          reportsOverTime={dashboard.reportsOverTime || []}
          communityMetrics={dashboard.communityMetrics}
          reportsBreakdown={dashboard.reportsBreakdown}
        />
      )}

      {activeSection === "team-capacity" && (
        <TeamCapacitySection
          dashboard={dashboard}
          teamStats={teamStats}
          staffLabelById={staffLabelById}
          assignmentForm={assignmentForm}
          setAssignmentForm={setAssignmentForm}
          selectedSurvivor={selectedSurvivor}
          reassignmentSuggestion={reassignmentSuggestion}
          onApplyReassignmentSuggestion={applyReassignmentSuggestion}
          staffForm={staffForm}
          setStaffForm={setStaffForm}
          togglingStaffId={togglingStaffId}
          reassignmentRequests={reassignmentRequests}
          reassignmentFilter={reassignmentFilter}
          setReassignmentFilter={setReassignmentFilter}
          reviewingRequestId={reviewingRequestId}
          onToggleActive={handleToggleStaffActive}
          onReassign={handleReassign}
          onStaffCreate={handleStaffCreate}
          onOpenBanModal={handleOpenBanModal}
          onUnban={handleUnban}
          onReviewRequest={handleReviewReassignmentRequest}
        />
      )}

      {activeSection === "moderation-desk" && (
        <ModerationDeskSection
          moderationQueue={dashboard.moderationQueue}
          selectedModerationRow={selectedModerationRow}
          setSelectedModerationRow={setSelectedModerationRow}
          onModerationAction={handleModerationAction}
          onOpenBanModal={handleOpenBanModal}
          onUnban={handleUnban}
          bannedUsers={bannedUsers}
          bannedUsersLoading={bannedUsersLoading}
          bannedUsersFilter={bannedUsersFilter}
          setBannedUsersFilter={setBannedUsersFilter}
          liftingBanId={liftingBanId}
          onLiftBan={handleUnbanFromRegistry}
          onBannedUsersTabOpen={loadBannedUsersData}
        />
      )}

      {activeSection === "ussd-callbacks" && (
        <UssdCallbacksSection
          ussdCallbacks={ussdCallbacks}
          updatingCallbackId={updatingCallbackId}
          onUpdateCallback={handleUpdateCallback}
        />
      )}

      {/* ── Inline sections (case-triage, reports, community-chat, resources) */}
      {activeSection === "case-triage" && (
        <section className="admin-module-grid" aria-label="Case triage">
          <article className="admin-panel full-span">
            <h2>Recent Urgent Cases</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Case ID</th>
                    <th>Date Submitted</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.recentUrgentCases || []).map((row) => (
                    <tr key={row.reportId}>
                      <td>{row.reportId}</td>
                      <td>{formatDate(row.reportCreationTimestamp)}</td>
                      <td><span className={priorityClass(row.severityLevel)}>{row.severityLevel}</span></td>
                      <td>{row.currentReportStatus}</td>
                      <td>
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => handleViewReportDetails(row.reportId)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedCaseReportId && (
              <div className="admin-empty" style={{ marginTop: "0.85rem", textAlign: "left" }}>
                {selectedCaseReport ? (
                  <>
                    <strong>Case Details:</strong> Report {selectedCaseReport.reportId} | Status {prettifyLabel(selectedCaseReport.currentReportStatus)}
                    {" | "}Priority {prettifyLabel(selectedCaseReport.severityLevel)} | Category {prettifyLabel(selectedCaseReport.incidentCategory)}
                  </>
                ) : (
                  <>
                    <strong>Case Details:</strong> Report {selectedCaseReportId} is not in the currently loaded report list.
                  </>
                )}
              </div>
            )}
          </article>

          <article className="admin-panel full-span">
            <h2>Case Intelligence Search</h2>
            <form className="admin-search" onSubmit={handleSearch}>
              <input
                type="search"
                placeholder="Search by case ID, user ID, or phone number"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <button type="submit" className="admin-action-btn" disabled={searching}>
                {searching ? "Searching..." : "Search"}
              </button>
            </form>
            <ul className="search-results">
              {searchResults.map((result, index) => (
                <li key={`${result.type}-${result.reportId || result.userId || index}`}>
                  <strong>{result.type}</strong>
                  <span>{result.reportId || result.userId}</span>
                  <span>{result.currentReportStatus || result.userRole || "-"}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}

      {activeSection === "community-chat" && (
        <section className="admin-module-grid" aria-label="Community chat supervision">
          <article className="admin-panel full-span">
            <h2>Live Community Chat Feed</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Room</th>
                    <th>Sender</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.recentCommunityMessages || []).map((row) => (
                    <tr key={row.messageId}>
                      <td>{formatDate(row.sentAt)}</td>
                      <td>{row.roomName}</td>
                      <td>{row.senderName}</td>
                      <td>{row.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="admin-panel full-span">
            <h2>Community Rooms Overview</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Members</th>
                    <th>Messages</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.communityRooms || []).map((room) => (
                    <tr key={room.roomId}>
                      <td>{room.roomName}</td>
                      <td>{formatNumber(room.memberCount)}</td>
                      <td>{formatNumber(room.messageCount)}</td>
                      <td>{formatDate(room.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeSection === "reports" && (
        <section className="admin-module-grid" aria-label="Reports visibility">
          <article className="admin-panel full-span">
            <h2>All Recent Reports</h2>
            <div className="report-taskbar">
              <div className="report-status-tabs" role="tablist" aria-label="Report status filters">
                {reportStatusTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={reportFilters.status === tab.value ? "active" : ""}
                    onClick={() => setReportFilters((prev) => ({ ...prev, status: tab.value }))}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
              <div className="report-filter-row">
                <input
                  type="search"
                  placeholder="Search report id, category, or status"
                  value={reportFilters.query}
                  onChange={(event) => setReportFilters((prev) => ({ ...prev, query: event.target.value }))}
                />
                <select
                  className={reportFilters.category !== "ALL" ? "filter-selected" : ""}
                  value={reportFilters.category}
                  onChange={(event) => setReportFilters((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {reportCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category === "ALL" ? "All categories" : prettifyLabel(category)}
                    </option>
                  ))}
                </select>
                <select
                  className={reportFilters.severity !== "ALL" ? "filter-selected" : ""}
                  value={reportFilters.severity}
                  onChange={(event) => setReportFilters((prev) => ({ ...prev, severity: event.target.value }))}
                >
                  <option value="ALL">All priority levels</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                <button
                  type="button"
                  className="admin-action-btn reset-filters-btn"
                  onClick={resetReportFilters}
                >
                  Reset Filters
                </button>
              </div>
              <div className="active-filters-row" aria-live="polite">
                <span className={`filter-pill ${reportFilters.status !== "ALL" ? "is-active" : ""}`}>
                  <strong>Status</strong>
                  <span>{reportFilters.status === "ALL" ? "All" : prettifyLabel(reportFilters.status)}</span>
                </span>
                <span className={`filter-pill ${reportFilters.category !== "ALL" ? "is-active" : ""}`}>
                  <strong>Category</strong>
                  <span>{reportFilters.category === "ALL" ? "All" : prettifyLabel(reportFilters.category)}</span>
                </span>
                <span className={`filter-pill ${reportFilters.severity !== "ALL" ? "is-active" : ""}`}>
                  <strong>Severity</strong>
                  <span>{reportFilters.severity === "ALL" ? "All" : reportFilters.severity}</span>
                </span>
                <span className={`filter-pill ${reportFilters.query.trim() ? "is-active" : ""}`}>
                  <strong>Search</strong>
                  <span>{reportFilters.query.trim() || "None"}</span>
                </span>
              </div>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Report ID</th>
                    <th>Created</th>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((row) => (
                    <tr key={row.reportId}>
                      <td>{row.reportId}</td>
                      <td>{formatDate(row.reportCreationTimestamp)}</td>
                      <td>{row.incidentCategory}</td>
                      <td><span className={priorityClass(row.severityLevel)}>{row.severityLevel}</span></td>
                      <td>{row.currentReportStatus}</td>
                      <td>
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => handleViewReportDetails(row.reportId)}
                          disabled={loadingReportDetailsFor === String(row.reportId)}
                        >
                          {loadingReportDetailsFor === String(row.reportId)
                            ? "Loading..."
                            : selectedCaseReportId === String(row.reportId)
                              ? "Hide Details"
                              : "View Details"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredReports.length === 0 && (
              <p className="admin-empty"><Inbox size={18} aria-hidden="true" />No reports match the selected filters.</p>
            )}
          </article>
        </section>
      )}

      {selectedCaseReportId && activeSection === "reports" && (
        <div className="admin-confirm-overlay" role="presentation" onClick={closeReportDetailsModal}>
          <article
            className="admin-confirm-modal report-details-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report details"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Report Details</h3>
            {loadingReportDetailsFor === selectedCaseReportId ? (
              <p>Loading detailed report view...</p>
            ) : selectedReportDetails ? (
              <>
                <p><strong>Report ID:</strong> {selectedReportDetails.reportId}</p>
                <p><strong>Status:</strong> {prettifyLabel(selectedReportDetails.reportStatus)}</p>
                <p><strong>Category:</strong> {prettifyLabel(selectedReportDetails.category)}</p>
                <p><strong>Severity:</strong> {selectedReportDetails.severityLevel}</p>
                <p><strong>Created:</strong> {formatDate(selectedReportDetails.createdAt)}</p>
                <p><strong>Incident date:</strong> {selectedReportDetails.date || "Not provided"}</p>
                <p><strong>Location:</strong> {selectedReportDetails.location || "Not provided"}</p>
                <p><strong>Description:</strong> {selectedReportDetails.description || "Not provided"}</p>

                {selectedReportDetails.legalCase && (
                  <p>
                    <strong>Legal case:</strong> {selectedReportDetails.legalCase.caseStatus}
                    {selectedReportDetails.legalCase.legalCaseId ? ` (${selectedReportDetails.legalCase.legalCaseId})` : ""}
                  </p>
                )}

                {(selectedReportDetails.evidence || []).length > 0 ? (
                  <div className="evidence-list">
                    <strong>Evidence files</strong>
                    {selectedReportDetails.evidence.map((evidence) => (
                      <button
                        key={evidence.evidenceId}
                        type="button"
                        className="footer-link"
                        onClick={() => handleOpenEvidence(selectedReportDetails.reportId, evidence.evidenceId)}
                        disabled={openingEvidenceId === evidence.evidenceId}
                      >
                        {openingEvidenceId === evidence.evidenceId
                          ? "Opening..."
                          : evidence.originalFileName || `${evidence.fileType} evidence`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>No evidence files attached.</p>
                )}
              </>
            ) : (
              <p>Full details are not available for this report right now.</p>
            )}

            <div className="admin-confirm-actions">
              <button type="button" className="secondary-btn" onClick={closeReportDetailsModal}>
                Close
              </button>
            </div>
          </article>
        </div>
      )}

      {activeSection === "resources" && (
        <section className="admin-module-grid" aria-label="Resources and operations">
          <article className="admin-panel full-span">
            <h2>Create or Edit Posted Resources</h2>
            <p className="admin-note">Keep fields descriptive so support teams can discover the right resource faster.</p>
            <form className="resource-form-grid" onSubmit={handleResourceSubmit}>
              <label>
                Resource title
                <input
                  type="text"
                  placeholder="Resource title"
                  value={resourceForm.title}
                  onChange={(event) => setResourceForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label>
                Category
                <input
                  type="text"
                  placeholder="Example: legal_guidance"
                  value={resourceForm.category}
                  onChange={(event) => setResourceForm((prev) => ({ ...prev, category: event.target.value }))}
                />
              </label>
              <label>
                Resource URL
                <input
                  type="url"
                  placeholder="https://..."
                  value={resourceForm.fileUrl}
                  onChange={(event) => setResourceForm((prev) => ({ ...prev, fileUrl: event.target.value }))}
                />
              </label>
              <label className="full-span">
                Description (optional)
                <input
                  type="text"
                  placeholder="Short context for counsellors and legal counsel"
                  value={resourceForm.description}
                  onChange={(event) => setResourceForm((prev) => ({ ...prev, description: event.target.value }))}
                />
              </label>

              <div className="resource-form-actions full-span">
                <button type="submit" className="admin-action-btn">
                  {editingResourceId ? "Save Changes" : "Create Resource"}
                </button>
                {editingResourceId && (
                  <button
                    type="button"
                    className="admin-action-btn"
                    onClick={() => {
                      setEditingResourceId("");
                      setResourceForm({ title: "", category: "", fileUrl: "", description: "" });
                    }}
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </article>

          <article className="admin-panel full-span">
            <h2>Posted Resources</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Uploaded</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Uploader</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.resources || []).map((resource) => (
                    <tr key={resource.resourceId}>
                      <td>{formatDate(resource.uploadedAt)}</td>
                      <td>{resource.title}</td>
                      <td>{resource.category}</td>
                      <td>{resource.uploadedBy?.phoneNumber || resource.uploadedBy?.userId || "-"}</td>
                      <td>
                        <button type="button" className="admin-action-btn" onClick={() => startEditResource(resource)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(dashboard.resources || []).length === 0 && (
              <p className="admin-empty" style={{ marginTop: "0.8rem" }}>
                <Inbox size={18} aria-hidden="true" />
                No resources have been posted yet.
              </p>
            )}
          </article>

          <article className="admin-panel full-span">
            <h2>Resource Access Analytics</h2>
            <div className="admin-panels two-col">
              <div className="admin-stat-card">
                <h3>Top Accessed Resources</h3>
                <ul className="search-results">
                  {(dashboard.resourceAnalytics?.topAccessedResources || []).map((item) => (
                    <li key={item.resourceId}>
                      <strong>{item.title}</strong>
                      <span>{prettifyLabel(item.category)}</span>
                      <span>{formatNumber(item.accessCount)} opens</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="admin-stat-card">
                <h3>Usage by Category</h3>
                <ul className="search-results">
                  {(dashboard.resourceAnalytics?.usageByCategory || []).map((item) => (
                    <li key={item.category}>
                      <strong>{prettifyLabel(item.category)}</strong>
                      <span>{formatNumber(item.accessCount)} opens</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </section>
      )}

      {/* ── Shared ban modal — rendered at root, opened from any section ── */}
      <BanUserModal
        banModal={banModal}
        setBanModal={setBanModal}
        banForm={banForm}
        setBanForm={setBanForm}
        banLoading={banLoading}
        onSubmit={handleSubmitBan}
      />
    </AdminWorkspace>
  );
}

export default NgoAdminDashboardPage;
