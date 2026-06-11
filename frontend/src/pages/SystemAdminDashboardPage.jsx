import { useEffect, useState } from "react";
import AdminWorkspace from "../components/AdminWorkspace";
import {
  getSystemAdminDashboard,
  setMaintenanceMode,
  getSystemLogs,
  performSystemRuntimeAction
} from "../services/admin";

/**
 * System Admin Dashboard
 * ----------------------
 * Operational control plane for infrastructure, maintenance, logs, and admin governance.
 *
 * Why this page is segmented:
 * - Infrastructure: current runtime health snapshot
 * - Operational Logs: near-real-time audit stream
 * - Maintenance Control: global user-traffic gate + runtime actions
 * - Admin Access: read-only system-admin directory and delegated governance guidance
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
              Staff onboarding and counsellor/legal-counsel lifecycle actions are managed by NGO administrators.
            </p>
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
    </AdminWorkspace>
  );
}

export default SystemAdminDashboardPage;
