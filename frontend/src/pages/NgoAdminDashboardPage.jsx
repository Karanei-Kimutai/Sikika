import { useEffect, useMemo, useState } from "react";
import AdminWorkspace from "../components/AdminWorkspace";
import {
  getNgoAdminDashboard,
  reviewModerationReport,
  runAdminSearch,
  createNgoResource,
  updateNgoResource,
  reassignSurvivorCase
} from "../services/admin";

/**
 * NGO Admin Dashboard
 * -------------------
 * Consolidates all NGO-operations views into one route-driven workspace.
 *
 * This page intentionally groups functionality by operational concern:
 * - Command Center: KPIs + trend analytics
 * - Case Triage: urgent queue + search
 * - Reports: status/category/severity filtering
 * - Team Capacity: staffing workload + reassignment
 * - Moderation Desk: harmful-content actions
 * - Resources: create/edit + access analytics
 */

const ngoMenu = [
  { id: "command-center", label: "Command Center", description: "Live KPIs and movement trends" },
  { id: "case-triage", label: "Case Triage", description: "Urgent case routing and alerts" },
  { id: "reports", label: "Reports", description: "All submitted reports and statuses" },
  { id: "community-chat", label: "Community Chat", description: "Room safety and support conversations" },
  { id: "team-capacity", label: "Team Capacity", description: "Counsellor and legal workload" },
  { id: "moderation-desk", label: "Moderation Desk", description: "Community safety decisions" },
  { id: "resources", label: "Resources", description: "Resource center and case intelligence" }
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function priorityClass(value) {
  const severity = String(value || "").toUpperCase();
  if (severity === "CRITICAL" || severity === "HIGH") return "pill priority-high";
  if (severity === "MEDIUM") return "pill priority-medium";
  return "pill priority-low";
}

function prettifyLabel(value) {
  return String(value || "-")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildLineChartPoints(series) {
  if (!series.length) return [];

  const width = 620;
  const height = 220;
  const padTop = 16;
  const padRight = 16;
  const padBottom = 34;
  const padLeft = 44;
  const max = Math.max(...series.map((item) => Number(item.count || 0)), 1);

  return series
    .map((item, index) => {
      const x = padLeft + (index * (width - padLeft - padRight)) / Math.max(series.length - 1, 1);
      const y = height - padBottom - ((Number(item.count || 0) / max) * (height - padTop - padBottom));
      return {
        x,
        y,
        count: Number(item.count || 0),
        date: item.date
      };
    });
}

function buildMovingAverage(series, windowSize = 7) {
  if (!series.length) return [];
  return series.map((point, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = series.slice(start, index + 1);
    const avg = slice.reduce((sum, item) => sum + Number(item.count || 0), 0) / slice.length;
    return { ...point, avg };
  });
}

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
  const [reportFilters, setReportFilters] = useState({
    status: "ALL",
    category: "ALL",
    severity: "ALL",
    query: ""
  });
  const [selectedCaseReportId, setSelectedCaseReportId] = useState("");

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
    loadDashboard();
  }, []);

  useEffect(() => {
    // App route aliases map to section ids through initialSection prop.
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!assignmentForm.survivorId) return;

    const selected = (dashboard?.survivorAssignments || []).find(
      (survivor) => survivor.survivorId === assignmentForm.survivorId
    );

    if (!selected) return;

    // Prefill with current assignment so reassignment edits are incremental.
    setAssignmentForm((prev) => ({
      ...prev,
      counsellorId: selected.assignedCounsellorId || "",
      legalCounselId: selected.assignedLegalCounselId || ""
    }));
  }, [assignmentForm.survivorId, dashboard]);

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
    // Toggle behavior: clicking the same row twice hides the detail summary.
    const value = String(reportId || "");
    setSelectedCaseReportId((prev) => (prev === value ? "" : value));
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

  const chartPoints = useMemo(
    // Chart is built from backend-provided 30-day dense series.
    () => buildLineChartPoints(dashboard?.reportsOverTime || []),
    [dashboard]
  );
  const movingAveragePoints = useMemo(() => buildMovingAverage(chartPoints), [chartPoints]);
  const polylinePoints = useMemo(
    () => chartPoints.map((point) => `${point.x},${point.y}`).join(" "),
    [chartPoints]
  );
  const avgPolylinePoints = useMemo(() => {
    const max = Math.max(...movingAveragePoints.map((point) => Number(point.avg || 0)), 1);
    const chartMaxBase = Math.max(...chartPoints.map((point) => Number(point.count || 0)), 1);
    const effectiveMax = Math.max(max, chartMaxBase, 1);
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    return movingAveragePoints
      .map((point) => {
        const y = height - padBottom - ((Number(point.avg || 0) / effectiveMax) * (height - padTop - padBottom));
        return `${point.x},${y}`;
      })
      .join(" ");
  }, [movingAveragePoints, chartPoints]);
  const hasTrendData = chartPoints.some((point) => point.count > 0);
  const trendTotal = chartPoints.reduce((sum, point) => sum + Number(point.count || 0), 0);
  const peakPoint = chartPoints.reduce((currentMax, point) => {
    if (!currentMax || point.count > currentMax.count) return point;
    return currentMax;
  }, null);
  const chartMax = useMemo(() => {
    const rawMax = Math.max(...chartPoints.map((point) => Number(point.count || 0)), 1);
    const step = rawMax <= 5 ? 1 : 2;
    return Math.ceil(rawMax / step) * step;
  }, [chartPoints]);
  const yTicks = useMemo(() => {
    const intervals = 4;
    return Array.from({ length: intervals + 1 }, (_, index) => Math.round((chartMax * index) / intervals));
  }, [chartMax]);
  const xTicks = useMemo(() => {
    if (!chartPoints.length) return [];
    return chartPoints.filter((_, index) => index % 7 === 0 || index === chartPoints.length - 1);
  }, [chartPoints]);

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

  function yForValue(value) {
    const width = 620;
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    const normalized = chartMax > 0 ? Number(value || 0) / chartMax : 0;
    return height - padBottom - normalized * (height - padTop - padBottom);
  }

  if (loading) {
    return (
      <main className="admin-page ngo-admin-theme">
        <section className="admin-shell">
          <p className="admin-empty">Loading NGO operations workspace...</p>
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="admin-page ngo-admin-theme">
        <section className="admin-shell">
          <p className="admin-empty">NGO workspace is unavailable right now.</p>
        </section>
      </main>
    );
  }

  const overview = dashboard.overview || {};
  const profileRows = [
    { label: "User", value: dashboard.profile?.userId || "NGO Admin" },
    { label: "Department", value: dashboard.profile?.department || "Operations" },
    { label: "Access", value: dashboard.profile?.accessLevel || 1 }
  ];
  const currentNgoSection = ngoMenu.find((item) => item.id === activeSection) || ngoMenu[0];

  return (
    <AdminWorkspace
      variant="ngo"
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
      {errorMessage && <p className="status-message warning">{errorMessage}</p>}
      {successMessage && <p className="status-message">{successMessage}</p>}

      {activeSection === "command-center" && (
        <section className="admin-module-grid" aria-label="Command center metrics">
          <article className="admin-stat-card">
            <h3>Total Reports</h3>
            <p className="admin-metric">{formatNumber(overview.totalReports)}</p>
            <span className={`trend ${Number(overview.reportTrendPercent || 0) >= 0 ? "up" : "down"}`}>
              {Number(overview.reportTrendPercent || 0) >= 0 ? "▲" : "▼"} {Math.abs(Number(overview.reportTrendPercent || 0))}% vs last month
            </span>
          </article>
          <article className="admin-stat-card">
            <h3>Active Survivors</h3>
            <p className="admin-metric">{formatNumber(overview.activeSurvivors)}</p>
            <span>Currently assigned and receiving support</span>
          </article>
          <article className="admin-stat-card">
            <h3>Average Response Time</h3>
            <p className="admin-metric">{formatNumber(overview.averageResponseMinutes)} mins</p>
            <span>Computed from open report timelines</span>
          </article>
          <article className="admin-stat-card">
            <h3>Active Legal Cases</h3>
            <p className="admin-metric">{formatNumber(overview.activeLegalCases)}</p>
            <span>Open and in-progress legal escalations</span>
          </article>

          <article className="admin-panel full-span">
            <h2>30 Day Case Trend</h2>
            <div className="chart-summary-row">
              <div className="chart-summary-card">
                <span>Reports in 30 days</span>
                <strong>{formatNumber(trendTotal)}</strong>
              </div>
              <div className="chart-summary-card">
                <span>Peak day</span>
                <strong>{peakPoint ? `${peakPoint.date} (${peakPoint.count})` : "-"}</strong>
              </div>
            </div>
            <svg viewBox="0 0 620 220" role="img" aria-label="Line chart showing reports over time">
              <rect x="0" y="0" width="620" height="220" rx="14" className="chart-backdrop" />
              {yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  <line x1="44" y1={yForValue(tick)} x2="604" y2={yForValue(tick)} className="chart-grid-line" />
                  <text x="36" y={yForValue(tick) + 4} className="chart-axis-label" textAnchor="end">
                    {tick}
                  </text>
                </g>
              ))}
              {polylinePoints ? <polyline points={polylinePoints} className="line-series" /> : null}
              {avgPolylinePoints ? <polyline points={avgPolylinePoints} className="line-series-average" /> : null}
              {chartPoints.map((point) => (
                <circle key={point.date} cx={point.x} cy={point.y} r="3.4" className="line-point">
                  <title>{`${point.date}: ${point.count} reports`}</title>
                </circle>
              ))}
              {xTicks.map((point) => (
                <text key={`x-${point.date}`} x={point.x} y="205" className="chart-axis-label" textAnchor="middle">
                  {point.date.slice(5)}
                </text>
              ))}
            </svg>
            <div className="chart-legend">
              <span><i className="legend-dot daily" /> Daily reports</span>
              <span><i className="legend-dot avg" /> 7-day average</span>
            </div>
            {!hasTrendData && <p className="admin-empty">No report activity in the last 30 days yet.</p>}
          </article>

          <article className="admin-panel full-span">
            <h2>Community Watch Metrics</h2>
            <div className="admin-panels two-col">
              <div className="admin-stat-card">
                <h3>Active Rooms</h3>
                <p className="admin-metric">{formatNumber(dashboard.communityMetrics?.activeRooms)}</p>
              </div>
              <div className="admin-stat-card">
                <h3>Total Community Messages</h3>
                <p className="admin-metric">{formatNumber(dashboard.communityMetrics?.totalMessages)}</p>
              </div>
              <div className="admin-stat-card">
                <h3>Harmful Content Reports</h3>
                <p className="admin-metric">{formatNumber(dashboard.communityMetrics?.harmfulContentReports)}</p>
              </div>
            </div>
          </article>

          <article className="admin-panel full-span">
            <h2>Report Breakdown</h2>
            <div className="breakdown-grid">
              {[{
                key: "category",
                title: "By Category",
                rows: dashboard.reportsBreakdown?.byCategory || [],
                labelKey: "category"
              }, {
                key: "status",
                title: "By Status",
                rows: dashboard.reportsBreakdown?.byStatus || [],
                labelKey: "status"
              }, {
                key: "county",
                title: "By County",
                rows: dashboard.reportsBreakdown?.byCounty || [],
                labelKey: "county"
              }].map((group) => {
                const max = Math.max(...group.rows.map((row) => Number(row.count || 0)), 1);

                return (
                  <article key={group.key} className="breakdown-card">
                    <h3>{group.title}</h3>
                    <ul className="breakdown-list">
                      {group.rows.map((row) => {
                        const rawLabel = row[group.labelKey];
                        const label = group.key === "county" ? String(rawLabel || "Unknown") : prettifyLabel(rawLabel);
                        const count = Number(row.count || 0);
                        const width = `${Math.max(8, Math.round((count / max) * 100))}%`;

                        return (
                          <li key={`${group.key}-${rawLabel}`} className="breakdown-row">
                            <div className="breakdown-row-top">
                              <span>{label}</span>
                              <strong>{formatNumber(count)}</strong>
                            </div>
                            <div className="breakdown-track">
                              <div className="breakdown-fill" style={{ width }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                );
              })}
            </div>
          </article>
        </section>
      )}

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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredReports.length === 0 && <p className="admin-empty">No reports match the selected filters.</p>}
          </article>
        </section>
      )}

      {activeSection === "team-capacity" && (
        <section className="admin-module-grid" aria-label="Team capacity">
          <article className="admin-panel full-span">
            <h2>Workload Distribution</h2>
            <div className="stacked-bars">
              {[...(dashboard.staffWorkload?.counsellors || []), ...(dashboard.staffWorkload?.legalCounsel || [])]
                .slice(0, 12)
                .map((staff) => (
                  <div key={staff.id} className="workload-row">
                    <span>{staff.label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.min(100, Number(staff.activeCases || 0) * 12)}%` }} />
                    </div>
                    <strong>{staff.activeCases}</strong>
                  </div>
                ))}
            </div>
            <p className="admin-empty">Bars represent active assigned survivors per staff member.</p>
          </article>

          <article className="admin-panel full-span">
            <h2>Staff Directory</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>Role</th>
                    <th>Specialization</th>
                    <th>Active Cases</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.staffDirectory || []).map((staff) => (
                    <tr key={`${staff.type}-${staff.id}`}>
                      <td>{staff.label}</td>
                      <td>{staff.type === "COUNSELLOR" ? "Counsellor" : "Legal Counsel"}</td>
                      <td>{staff.specialization}</td>
                      <td>{formatNumber(staff.activeCases)}</td>
                      <td>{staff.availability}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="admin-panel full-span">
            <h2>Manual Survivor Reassignment</h2>
            <p className="admin-empty">Use this form when a survivor requests a change or staff workload becomes high.</p>
            <div className="selection-summary-card">
              <h3>Current Selection</h3>
              <p><strong>Survivor:</strong> {selectedSurvivor ? `${selectedSurvivor.nickname} (${selectedSurvivor.county || "Unknown"})` : "Not selected"}</p>
              <p><strong>Counsellor:</strong> {assignmentForm.counsellorId ? (staffLabelById.get(assignmentForm.counsellorId) || assignmentForm.counsellorId) : "No change"}</p>
              <p><strong>Legal Counsel:</strong> {assignmentForm.legalCounselId ? (staffLabelById.get(assignmentForm.legalCounselId) || assignmentForm.legalCounselId) : "No change"}</p>
            </div>
            <form className="reassignment-form" onSubmit={handleReassign}>
              <label>
                Survivor
                <select
                  className={assignmentForm.survivorId ? "selected-value" : ""}
                  value={assignmentForm.survivorId}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, survivorId: event.target.value }))}
                >
                  <option value="">Select survivor</option>
                  {(dashboard.survivorAssignments || []).map((survivor) => (
                    <option key={survivor.survivorId} value={survivor.survivorId}>
                      {survivor.nickname} ({survivor.county || "Unknown county"})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                New Counsellor
                <select
                  className={assignmentForm.counsellorId ? "selected-value" : ""}
                  value={assignmentForm.counsellorId}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, counsellorId: event.target.value }))}
                >
                  <option value="">No change</option>
                  {(dashboard.staffWorkload?.counsellors || []).map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.label}</option>
                  ))}
                </select>
              </label>

              <label>
                New Legal Counsel
                <select
                  className={assignmentForm.legalCounselId ? "selected-value" : ""}
                  value={assignmentForm.legalCounselId}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, legalCounselId: event.target.value }))}
                >
                  <option value="">No change</option>
                  {(dashboard.staffWorkload?.legalCounsel || []).map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.label}</option>
                  ))}
                </select>
              </label>

              <label className="full-span">
                Reassignment Reason
                <input
                  type="text"
                  placeholder="Example: survivor requested counsellor change due to schedule mismatch"
                  value={assignmentForm.reason}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, reason: event.target.value }))}
                />
              </label>

              <button type="submit" className="admin-action-btn">Apply Reassignment</button>
            </form>
          </article>
        </section>
      )}

      {activeSection === "moderation-desk" && (
        <section className="admin-module-grid" aria-label="Moderation desk">
          <article className="admin-panel full-span">
            <h2>Community Moderation Queue</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Room</th>
                    <th>Message Snippet</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.moderationQueue || []).map((row) => (
                    <tr key={row.reportId}>
                      <td>{formatDate(row.submittedAt)}</td>
                      <td>{row.roomName}</td>
                      <td>{row.snippet}</td>
                      <td className="action-cell">
                        <button type="button" className="admin-action-btn" onClick={() => handleModerationAction(row.reportId, "remove_message")}>
                          Delete Message
                        </button>
                        <button type="button" className="admin-action-btn" onClick={() => handleModerationAction(row.reportId, "issue_warning")}>
                          Issue Warning
                        </button>
                        <button type="button" className="admin-action-btn danger" onClick={() => handleModerationAction(row.reportId, "suspend_user")}>
                          Suspend User
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeSection === "resources" && (
        <section className="admin-module-grid" aria-label="Resources and operations">
          <article className="admin-panel full-span">
            <h2>Create or Edit Posted Resources</h2>
            <form className="admin-search" onSubmit={handleResourceSubmit}>
              <input
                type="text"
                placeholder="Resource title"
                value={resourceForm.title}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <input
                type="text"
                placeholder="Category (example: legal_guidance)"
                value={resourceForm.category}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, category: event.target.value }))}
              />
              <input
                type="url"
                placeholder="Resource URL"
                value={resourceForm.fileUrl}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, fileUrl: event.target.value }))}
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={resourceForm.description}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, description: event.target.value }))}
              />
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
    </AdminWorkspace>
  );
}

export default NgoAdminDashboardPage;
