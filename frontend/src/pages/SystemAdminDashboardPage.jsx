import { useEffect, useState } from "react";
import AdminWorkspace from "../components/AdminWorkspace";
import {
  getSystemAdminDashboard,
  setMaintenanceMode,
  getSystemLogs,
  performSystemRuntimeAction,
  createSystemStaffAccount,
  updateSystemStaffStatus
} from "../services/admin";

/**
 * System Admin Dashboard
 * ----------------------
 * Operational control plane for infrastructure, maintenance, logs, and staff lifecycle.
 *
 * Why this page is segmented:
 * - Infrastructure: current runtime health snapshot
 * - Operational Logs: near-real-time audit stream
 * - Maintenance Control: global user-traffic gate + runtime actions
 * - Admin Access: staff creation and account status governance
 */

const systemMenu = [
  { id: "infrastructure", label: "Infrastructure", description: "Runtime health and dependencies" },
  { id: "ops-logs", label: "Operational Logs", description: "Audit stream and anomaly traces" },
  { id: "maintenance", label: "Maintenance Control", description: "Downtime and service actions" },
  { id: "admin-access", label: "Admin Access", description: "Platform admin directory and privileges" }
];

function formatSecondsToReadable(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatCountdown(value) {
  if (!value) return "Not specified";
  const ms = new Date(value).getTime() - Date.now();
  if (Number.isNaN(ms)) return "Not specified";
  if (ms <= 0) return "Due now";

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m remaining`;
}

function SystemAdminDashboardPage({ onNavigate, onSignOut, initialSection = "infrastructure" }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [activeSection, setActiveSection] = useState("infrastructure");
  const [liveLogs, setLiveLogs] = useState([]);
  const [maintenanceReasonInput, setMaintenanceReasonInput] = useState("");
  const [maintenanceExpectedUntilInput, setMaintenanceExpectedUntilInput] = useState("");
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [staffForm, setStaffForm] = useState({
    phoneNumber: "",
    password: "",
    role: "COUNSELLOR",
    specialization: "",
    availabilityStatus: "AVAILABLE",
    administrativeDepartment: "",
    accessLevel: "1",
    maintenancePrivileges: ""
  });

  async function loadDashboard() {
    // One aggregate payload avoids cross-panel drift between cards and controls.
    setLoading(true);
    setErrorMessage("");

    try {
      const data = await getSystemAdminDashboard();
      setDashboard(data);
      setMaintenanceReasonInput(data.maintenanceMode?.reason || "");
      if (data.maintenanceMode?.expectedUntil) {
        // datetime-local expects local-time format without seconds/timezone suffix.
        const date = new Date(data.maintenanceMode.expectedUntil);
        if (!Number.isNaN(date.getTime())) {
          const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setMaintenanceExpectedUntilInput(local);
        } else {
          setMaintenanceExpectedUntilInput("");
        }
      } else {
        setMaintenanceExpectedUntilInput("");
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to load system admin workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial dashboard bootstrap.
    loadDashboard();
  }, []);

  useEffect(() => {
    // Route aliases resolve to a default section via initialSection prop.
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    let timerId = null;

    async function fetchLiveLogs() {
      try {
        const data = await getSystemLogs();
        setLiveLogs(Array.isArray(data.logs) ? data.logs : []);
      } catch {
        // Keep last-known logs in place if a poll fails.
      }
    }

    if (activeSection === "ops-logs") {
      // Poll only when logs panel is visible to reduce background traffic.
      fetchLiveLogs();
      timerId = setInterval(fetchLiveLogs, 6000);
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [activeSection]);

  useEffect(() => {
    if (!pendingStatusChange) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setPendingStatusChange(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingStatusChange]);

  async function toggleMaintenanceMode(enabled) {
    setActionMessage("");
    setErrorMessage("");

    try {
      const expectedUntil = maintenanceExpectedUntilInput
        ? new Date(maintenanceExpectedUntilInput).toISOString()
        : null;

      const data = await setMaintenanceMode(enabled, {
        reason: maintenanceReasonInput,
        expectedUntil
      });
      setActionMessage(data.message || "Maintenance state updated.");
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to change maintenance mode.");
    }
  }

  async function handleRuntimeAction(action) {
    setActionMessage("");
    setErrorMessage("");

    try {
      const data = await performSystemRuntimeAction(action);
      setActionMessage(data.message || "Runtime action completed.");
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to execute runtime action.");
    }
  }

  async function handleStaffCreate(event) {
    event.preventDefault();
    setActionMessage("");
    setErrorMessage("");

    const payload = {
      phoneNumber: staffForm.phoneNumber.trim(),
      password: staffForm.password,
      role: staffForm.role,
      specialization: staffForm.specialization.trim(),
      availabilityStatus: staffForm.availabilityStatus,
      administrativeDepartment: staffForm.administrativeDepartment.trim(),
      accessLevel: Number(staffForm.accessLevel || 1),
      maintenancePrivileges: staffForm.maintenancePrivileges.trim()
    };

    if (!payload.phoneNumber || !payload.password) {
      setErrorMessage("Phone number and password are required for staff onboarding.");
      return;
    }

    try {
      const data = await createSystemStaffAccount(payload);
      setActionMessage(data.message || "Staff account created.");
      setStaffForm((prev) => ({
        ...prev,
        phoneNumber: "",
        password: "",
        specialization: "",
        administrativeDepartment: "",
        maintenancePrivileges: ""
      }));
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to create staff account.");
    }
  }

  async function handleStaffStatusChange(userId, status) {
    setActionMessage("");
    setErrorMessage("");

    try {
      const data = await updateSystemStaffStatus(userId, status);
      setActionMessage(data.message || "Staff status updated.");
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to update staff account status.");
    }
  }

  function requestStaffStatusChange(entry, nextStatus) {
    // Confirmation modal prevents accidental suspension/reactivation clicks.
    setPendingStatusChange({
      userId: entry.userId,
      phoneNumber: entry.phoneNumber,
      role: entry.role,
      nextStatus
    });
  }

  async function confirmStaffStatusChange() {
    if (!pendingStatusChange) return;

    await handleStaffStatusChange(pendingStatusChange.userId, pendingStatusChange.nextStatus);
    setPendingStatusChange(null);
  }

  if (loading) {
    return (
      <main className="admin-page system-admin-theme">
        <section className="admin-shell">
          <p className="admin-empty">Loading system operations workspace...</p>
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="admin-page system-admin-theme">
        <section className="admin-shell">
          <p className="admin-empty">System workspace is unavailable right now.</p>
        </section>
      </main>
    );
  }

  const profileRows = [
    { label: "User", value: dashboard.profile?.userId || "System Admin" },
    { label: "Access Level", value: dashboard.profile?.systemAccessLevel || 1 },
    { label: "Role", value: "Infrastructure Governance" }
  ];
  const currentSystemSection = systemMenu.find((item) => item.id === activeSection) || systemMenu[0];

  return (
    <AdminWorkspace
      variant="system"
      roleLabel="System Administrator"
      title={currentSystemSection?.label || "System Admin"}
      subtitle={currentSystemSection?.description || "System operations workspace"}
      profile={profileRows}
      menuItems={systemMenu}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
      showSidebar={false}
    >
      {errorMessage && <p className="status-message warning">{errorMessage}</p>}
      {actionMessage && <p className="status-message">{actionMessage}</p>}

      {activeSection === "infrastructure" && (
        <section className="admin-module-grid" aria-label="Infrastructure overview">
          <article className="admin-panel full-span admin-panel-intro">
            <h2>What Infrastructure Means</h2>
            <p>
              This tab monitors platform health: backend uptime, database connectivity and latency,
              and OTP channel readiness. Use it to quickly confirm whether core dependencies are healthy.
            </p>
          </article>
          <article className="admin-stat-card system-status-card">
            <h3>System Status</h3>
            <p className={`system-badge ${dashboard.statusBadge === "ALL_SYSTEMS_OPERATIONAL" ? "ok" : "warn"}`}>
              {dashboard.statusBadge === "ALL_SYSTEMS_OPERATIONAL" ? "All Systems Operational" : "Degraded Performance"}
            </p>
          </article>
          <article className="admin-stat-card">
            <h3>Server Uptime</h3>
            <p className="admin-metric">{formatSecondsToReadable(dashboard.metrics?.serverUptimeSeconds)}</p>
            <span>Since last backend restart</span>
          </article>
          <article className="admin-stat-card">
            <h3>Database Connection</h3>
            <p className="admin-metric">{dashboard.metrics?.databaseConnectionStatus}</p>
            <span>Latency: {dashboard.metrics?.databaseLatencyMs ?? "-"} ms</span>
          </article>
          <article className="admin-stat-card">
            <h3>OTP Gateway</h3>
            <p className="admin-metric">{dashboard.metrics?.otpGatewayStatus}</p>
            <span>Authentication channel status</span>
          </article>
        </section>
      )}

      {activeSection === "ops-logs" && (
        <section className="admin-module-grid" aria-label="Operational logs">
          <article className="admin-panel full-span admin-panel-intro">
            <h2>What Operational Logs Mean</h2>
            <p>
              Operational logs are the live stream of admin actions and system audit events.
              They help you trace incidents, verify who changed what, and diagnose anomalies.
            </p>
          </article>
          <article className="admin-panel full-span">
            <h2>Error and Audit Stream</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Fault Code</th>
                    <th>Server Module</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {(liveLogs.length ? liveLogs : (dashboard.errorLogs || []).slice(0, 25)).map((log, index) => (
                    <tr key={`${log.timestamp}-${index}`}>
                      <td>{formatDate(log.timestamp)}</td>
                      <td>{log.faultCode}</td>
                      <td>{log.module}</td>
                      <td>{log.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeSection === "maintenance" && (
        <section className="admin-module-grid" aria-label="Maintenance controls">
          <article className="admin-panel full-span admin-panel-intro">
            <h2>What Maintenance Control Means</h2>
            <p>
              Use this tab to temporarily restrict normal user traffic during upgrades or emergency fixes,
              communicate a reason and expected return time, and trigger runtime actions like cache clear.
            </p>
          </article>
          <article className="admin-panel full-span">
            <h2>Maintenance and Runtime Control</h2>
            <div className="maintenance-controls">
              <p>
                <strong>Maintenance Mode:</strong> {dashboard.maintenanceMode?.enabled ? "Enabled" : "Disabled"}
              </p>
              <p>
                <strong>Last Updated:</strong> {formatDate(dashboard.maintenanceMode?.updatedAt)}
              </p>
              <p>
                <strong>Last Cache Clear:</strong> {formatDate(dashboard.runtimeActions?.lastCacheClearAt)}
              </p>
              <p>
                <strong>Last Restart Request:</strong> {formatDate(dashboard.runtimeActions?.lastRestartRequestAt)}
              </p>
              <p>
                <strong>Reason:</strong> {dashboard.maintenanceMode?.reason || "-"}
              </p>
              <p>
                <strong>Expected Return:</strong> {formatDate(dashboard.maintenanceMode?.expectedUntil)}
              </p>
              <p>
                <strong>Countdown:</strong> {formatCountdown(dashboard.maintenanceMode?.expectedUntil)}
              </p>
              <label className="maintenance-input-label">
                Maintenance reason
                <input
                  type="text"
                  value={maintenanceReasonInput}
                  onChange={(event) => setMaintenanceReasonInput(event.target.value)}
                  placeholder="Scheduled DB migration"
                />
              </label>
              <label className="maintenance-input-label">
                Expected back at
                <input
                  type="datetime-local"
                  value={maintenanceExpectedUntilInput}
                  onChange={(event) => setMaintenanceExpectedUntilInput(event.target.value)}
                />
              </label>
              <div className="maintenance-actions">
                <button type="button" className="admin-action-btn danger" onClick={() => toggleMaintenanceMode(true)}>
                  Enable Maintenance Mode
                </button>
                <button type="button" className="admin-action-btn" onClick={() => toggleMaintenanceMode(false)}>
                  Disable Maintenance Mode
                </button>
                <button type="button" className="admin-action-btn" onClick={() => handleRuntimeAction('RESTART_SERVER')}>
                  Restart Node.js Service
                </button>
                <button type="button" className="admin-action-btn" onClick={() => handleRuntimeAction('CLEAR_CACHE')}>
                  Clear System Cache
                </button>
              </div>
            </div>
          </article>
        </section>
      )}

      {activeSection === "admin-access" && (
        <section className="admin-module-grid" aria-label="Admin access">
          <article className="admin-panel full-span admin-panel-intro">
            <h2>What Admin Access Means</h2>
            <p>
              This directory shows system-admin accounts, privilege levels, and account status.
              Use it to verify who is authorized for critical platform operations.
            </p>
          </article>
          <article className="admin-panel full-span">
            <h2>Create Staff Account</h2>
            <p className="admin-empty">Use this form to onboard counsellors, legal counsel, NGO admins, and system admins.</p>
            <form className="reassignment-form" onSubmit={handleStaffCreate}>
              <label>
                Phone Number
                <input
                  type="text"
                  value={staffForm.phoneNumber}
                  onChange={(event) => setStaffForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                  placeholder="+2547XXXXXXXX"
                />
              </label>
              <label>
                Temporary Password
                <input
                  type="password"
                  value={staffForm.password}
                  onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))}
                  placeholder="At least 6 characters"
                />
              </label>
              <label>
                Staff Role
                <select
                  value={staffForm.role}
                  onChange={(event) => setStaffForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <option value="COUNSELLOR">Counsellor</option>
                  <option value="LEGAL_COUNSEL">Legal Counsel</option>
                  <option value="NGO_ADMIN">NGO Admin</option>
                  <option value="SYSTEM_ADMIN">System Admin</option>
                </select>
              </label>
              {(staffForm.role === "COUNSELLOR" || staffForm.role === "LEGAL_COUNSEL") && (
                <>
                  <label>
                    Specialization
                    <input
                      type="text"
                      value={staffForm.specialization}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, specialization: event.target.value }))}
                      placeholder={staffForm.role === "COUNSELLOR" ? "Trauma support" : "Family law"}
                    />
                  </label>
                  <label>
                    Availability
                    <select
                      value={staffForm.availabilityStatus}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, availabilityStatus: event.target.value }))}
                    >
                      <option value="AVAILABLE">Available</option>
                      <option value="BUSY">Busy</option>
                      <option value="OFFLINE">Offline</option>
                    </select>
                  </label>
                </>
              )}

              {staffForm.role === "NGO_ADMIN" && (
                <>
                  <label>
                    Department
                    <input
                      type="text"
                      value={staffForm.administrativeDepartment}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, administrativeDepartment: event.target.value }))}
                      placeholder="Case Management"
                    />
                  </label>
                  <label>
                    Access Level
                    <input
                      type="number"
                      min="1"
                      value={staffForm.accessLevel}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, accessLevel: event.target.value }))}
                    />
                  </label>
                </>
              )}

              {staffForm.role === "SYSTEM_ADMIN" && (
                <>
                  <label>
                    Access Level
                    <input
                      type="number"
                      min="1"
                      value={staffForm.accessLevel}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, accessLevel: event.target.value }))}
                    />
                  </label>
                  <label className="full-span">
                    Maintenance Privileges
                    <input
                      type="text"
                      value={staffForm.maintenancePrivileges}
                      onChange={(event) => setStaffForm((prev) => ({ ...prev, maintenancePrivileges: event.target.value }))}
                      placeholder="server_restart,log_access,cache_control"
                    />
                  </label>
                </>
              )}

              <button type="submit" className="admin-action-btn">Create Staff</button>
            </form>
          </article>

          <article className="admin-panel full-span">
            <h2>All Staff Directory</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Phone</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Password Reset</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.staffDirectory || []).map((entry) => (
                    <tr key={`staff-${entry.userId}`}>
                      <td>{entry.userId}</td>
                      <td>{entry.phoneNumber}</td>
                      <td>{entry.role}</td>
                      <td>{entry.accountStatus}</td>
                      <td>{entry.passwordResetRequired ? "Required" : "No"}</td>
                      <td>{formatDate(entry.createdAt)}</td>
                      <td className="action-cell">
                        {entry.accountStatus === "SUSPENDED" ? (
                          <button
                            type="button"
                            className="admin-action-btn"
                            onClick={() => requestStaffStatusChange(entry, "ACTIVE")}
                          >
                            Reactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-action-btn danger"
                            onClick={() => requestStaffStatusChange(entry, "SUSPENDED")}
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="admin-panel full-span">
            <h2>System Admin Directory</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Admin ID</th>
                    <th>Phone</th>
                    <th>Access Level</th>
                    <th>Privileges</th>
                    <th>Account Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.adminDirectory || []).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.userId}</td>
                      <td>{entry.phoneNumber}</td>
                      <td>{entry.systemAccessLevel}</td>
                      <td>{entry.maintenancePrivileges}</td>
                      <td>{entry.accountStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {pendingStatusChange && (
        <div
          className="admin-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-status-title"
          onClick={() => setPendingStatusChange(null)}
        >
          <article className="admin-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3 id="confirm-status-title">
              Confirm {pendingStatusChange.nextStatus === "SUSPENDED" ? "Suspension" : "Reactivation"}
            </h3>
            <p>
              You are about to {pendingStatusChange.nextStatus === "SUSPENDED" ? "suspend" : "reactivate"} this staff account.
            </p>
            <p>
              <strong>User:</strong> {pendingStatusChange.userId}
            </p>
            <p>
              <strong>Phone:</strong> {pendingStatusChange.phoneNumber}
            </p>
            <p>
              <strong>Role:</strong> {pendingStatusChange.role}
            </p>

            <div className="admin-confirm-actions">
              <button
                type="button"
                className={`admin-action-btn ${pendingStatusChange.nextStatus === "SUSPENDED" ? "danger" : ""}`}
                onClick={confirmStaffStatusChange}
              >
                Confirm
              </button>
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setPendingStatusChange(null)}
              >
                Cancel
              </button>
            </div>
          </article>
        </div>
      )}
    </AdminWorkspace>
  );
}

export default SystemAdminDashboardPage;
