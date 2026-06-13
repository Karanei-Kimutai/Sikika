import { useMemo } from "react";
import { formatNumber, prettifyLabel, buildLineChartPoints, buildMovingAverage } from "./helpers";

/**
 * CommandCenterSection
 * --------------------
 * KPI stat cards + 30-day report trend chart + community metrics +
 * report breakdown by category/status/county.
 *
 * Owns all chart-math derivations so the parent component doesn't need to
 * hold SVG-specific memos. Accepts a Lucide icon component as `statIcons`
 * for each card (Phase 5 extension point — currently unused, but the prop
 * seam is present so callers don't need to change later).
 *
 * @param {object}  props
 * @param {object}  props.overview           - dashboard.overview aggregation object.
 * @param {Array}   props.reportsOverTime     - 30-day dense series from the backend.
 * @param {object}  props.communityMetrics    - dashboard.communityMetrics object.
 * @param {object}  props.reportsBreakdown    - dashboard.reportsBreakdown object.
 */
export default function CommandCenterSection({ overview, reportsOverTime, communityMetrics, reportsBreakdown }) {
  // ── Chart derivations (self-contained; only used in this section) ─────────
  const chartPoints = useMemo(
    () => buildLineChartPoints(reportsOverTime || []),
    [reportsOverTime]
  );
  const movingAveragePoints = useMemo(() => buildMovingAverage(chartPoints), [chartPoints]);
  const polylinePoints = useMemo(
    () => chartPoints.map((point) => `${point.x},${point.y}`).join(" "),
    [chartPoints]
  );
  const chartMax = useMemo(() => {
    const rawMax = Math.max(...chartPoints.map((p) => Number(p.count || 0)), 1);
    const step = rawMax <= 5 ? 1 : 2;
    return Math.ceil(rawMax / step) * step;
  }, [chartPoints]);
  const avgPolylinePoints = useMemo(() => {
    const max = Math.max(...movingAveragePoints.map((p) => Number(p.avg || 0)), 1);
    const effectiveMax = Math.max(max, chartMax, 1);
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    return movingAveragePoints
      .map((point) => {
        const y = height - padBottom - ((Number(point.avg || 0) / effectiveMax) * (height - padTop - padBottom));
        return `${point.x},${y}`;
      })
      .join(" ");
  }, [movingAveragePoints, chartMax]);
  const hasTrendData = chartPoints.some((p) => p.count > 0);
  const trendTotal = chartPoints.reduce((sum, p) => sum + Number(p.count || 0), 0);
  const peakPoint = chartPoints.reduce((current, p) => {
    if (!current || p.count > current.count) return p;
    return current;
  }, null);
  const yTicks = useMemo(() => {
    const intervals = 4;
    return Array.from({ length: intervals + 1 }, (_, i) => Math.round((chartMax * i) / intervals));
  }, [chartMax]);
  const xTicks = useMemo(() => {
    if (!chartPoints.length) return [];
    return chartPoints.filter((_, i) => i % 7 === 0 || i === chartPoints.length - 1);
  }, [chartPoints]);

  /** Maps a y-axis value to an SVG y-coordinate using the local chartMax. */
  function yForValue(value) {
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    const normalized = chartMax > 0 ? Number(value || 0) / chartMax : 0;
    return height - padBottom - normalized * (height - padTop - padBottom);
  }

  return (
    <section className="admin-module-grid" aria-label="Command center metrics">
      {/* ── KPI stat cards ─────────────────────────────────────────────── */}
      <article className="admin-stat-card">
        <h3>Total Reports</h3>
        <p className="admin-metric">{formatNumber(overview?.totalReports)}</p>
        <span className={`trend ${Number(overview?.reportTrendPercent || 0) >= 0 ? "up" : "down"}`}>
          {Number(overview?.reportTrendPercent || 0) >= 0 ? "▲" : "▼"} {Math.abs(Number(overview?.reportTrendPercent || 0))}% vs last month
        </span>
      </article>
      <article className="admin-stat-card">
        <h3>Active Survivors</h3>
        <p className="admin-metric">{formatNumber(overview?.activeSurvivors)}</p>
        <span>Currently assigned and receiving support</span>
      </article>
      <article className="admin-stat-card">
        <h3>Average Response Time</h3>
        <p className="admin-metric">{formatNumber(overview?.averageResponseMinutes)} mins</p>
        <span>
          Computed from first survivor-to-staff replies in direct chat
          {Number(overview?.averageResponseSampleCount || 0) > 0
            ? ` (${formatNumber(overview?.averageResponseSampleCount)} samples)`
            : ""}
        </span>
      </article>
      <article className="admin-stat-card">
        <h3>Active Legal Cases</h3>
        <p className="admin-metric">{formatNumber(overview?.activeLegalCases)}</p>
        <span>Open and in-progress legal escalations</span>
      </article>

      {/* ── 30-day trend chart ─────────────────────────────────────────── */}
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

      {/* ── Community watch metrics ────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Community Watch Metrics</h2>
        <div className="admin-panels two-col">
          <div className="admin-stat-card">
            <h3>Active Rooms</h3>
            <p className="admin-metric">{formatNumber(communityMetrics?.activeRooms)}</p>
          </div>
          <div className="admin-stat-card">
            <h3>Total Community Messages</h3>
            <p className="admin-metric">{formatNumber(communityMetrics?.totalMessages)}</p>
          </div>
          <div className="admin-stat-card">
            <h3>Harmful Content Reports</h3>
            <p className="admin-metric">{formatNumber(communityMetrics?.harmfulContentReports)}</p>
          </div>
        </div>
      </article>

      {/* ── Report breakdown ───────────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Report Breakdown</h2>
        <div className="breakdown-grid">
          {[{
            key: "category",
            title: "By Category",
            rows: reportsBreakdown?.byCategory || [],
            labelKey: "category"
          }, {
            key: "status",
            title: "By Status",
            rows: reportsBreakdown?.byStatus || [],
            labelKey: "status"
          }, {
            key: "county",
            title: "By County",
            rows: reportsBreakdown?.byCounty || [],
            labelKey: "county"
          }].map((group) => {
            const max = Math.max(...group.rows.map((row) => Number(row.count || 0)), 1);
            return (
              <article key={group.key} className="breakdown-card">
                <h3>{group.title}</h3>
                <ul className="breakdown-list">
                  {group.rows.map((row) => {
                    const rawLabel = row[group.labelKey];
                    const label = group.key === "county"
                      ? String(rawLabel || "Unknown")
                      : prettifyLabel(rawLabel);
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
  );
}
