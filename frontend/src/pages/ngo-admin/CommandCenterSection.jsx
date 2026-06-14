import { useMemo } from "react";
import { formatNumber, prettifyLabel, buildLineChartPoints, buildMovingAverage } from "./helpers";

/**
 * CommandCenterSection
 * --------------------
 * KPI stat cards + 30-day report trend chart + community metrics +
 * report breakdown by category/status/county.
 *
 * Chart design: soft rounded **bars** show daily granularity; a single dashed
 * **7-day average trend line** sits on top as the signal. Both share the same
 * rounded Y-axis scale (chartMax) so gridlines, labels, bars, and the line
 * are perfectly aligned.
 *
 * @param {object}  props
 * @param {object}  props.overview           - dashboard.overview aggregation object.
 * @param {Array}   props.reportsOverTime     - 30-day dense series from the backend.
 * @param {object}  props.communityMetrics    - dashboard.communityMetrics object.
 * @param {object}  props.reportsBreakdown    - dashboard.reportsBreakdown object.
 */
export default function CommandCenterSection({ overview, reportsOverTime, communityMetrics, reportsBreakdown }) {
  // ── Shared vertical scale (computed once; used by bars, gridlines, and avg line) ──
  const chartMax = useMemo(() => {
    const rawMax = Math.max(...(reportsOverTime || []).map((p) => Number(p.count || 0)), 1);
    // Choose a step that keeps Y-axis tick labels from crowding for any data range.
    const step = rawMax <= 5 ? 1 : rawMax <= 20 ? 2 : rawMax <= 50 ? 5 : 10;
    return Math.ceil(rawMax / step) * step;
  }, [reportsOverTime]);

  // buildLineChartPoints now receives chartMax so bar Y-coords use the same scale
  // as the axis labels and gridlines — no more dual-scale mismatch.
  const chartPoints = useMemo(
    () => buildLineChartPoints(reportsOverTime || [], chartMax),
    [reportsOverTime, chartMax]
  );

  // 7-day moving average, keyed by the same x positions as the bars.
  const movingAveragePoints = useMemo(() => buildMovingAverage(chartPoints), [chartPoints]);

  // Single trend polyline using the shared chartMax for Y — replacing the old
  // "avgPolylinePoints" that had its own independent max computation.
  const avgPolylinePoints = useMemo(() => {
    if (!movingAveragePoints.length) return "";
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    return movingAveragePoints
      .map((point) => {
        const y =
          height - padBottom -
          (Number(point.avg || 0) / Math.max(chartMax, 1)) * (height - padTop - padBottom);
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

  // Y-axis gridlines at 5 evenly-spaced values (0 → chartMax).
  const yTicks = useMemo(() => {
    const intervals = 4;
    return Array.from({ length: intervals + 1 }, (_, i) => Math.round((chartMax * i) / intervals));
  }, [chartMax]);

  // X-axis: label every 7th day plus the last, formatted as "Jun 07".
  const xTicks = useMemo(() => {
    if (!chartPoints.length) return [];
    return chartPoints.filter((_, i) => i % 7 === 0 || i === chartPoints.length - 1);
  }, [chartPoints]);

  /** Maps a y-axis value → SVG y-coordinate using the shared chartMax. */
  function yForValue(value) {
    const height = 220;
    const padTop = 16;
    const padBottom = 34;
    const normalized = chartMax > 0 ? Number(value || 0) / chartMax : 0;
    return height - padBottom - normalized * (height - padTop - padBottom);
  }

  /**
   * Formats a "YYYY-MM-DD" date string as a short "Mon DD" label for X-axis ticks.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDayLabel(dateStr) {
    if (!dateStr) return "";
    const [, month, day] = dateStr.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[Number(month) - 1] || ""} ${day}`;
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
        <h2>30-Day Case Trend</h2>
        <div className="chart-summary-row">
          <div className="chart-summary-card">
            <span>Reports in 30 days</span>
            <strong>{formatNumber(trendTotal)}</strong>
          </div>
          <div className="chart-summary-card">
            <span>Peak day</span>
            <strong>
              {peakPoint && peakPoint.count > 0
                ? `${formatDayLabel(peakPoint.date)} (${peakPoint.count})`
                : "-"}
            </strong>
          </div>
        </div>

        {/*
          Design: bars = daily granularity (background context)
                  dashed line = 7-day rolling average (primary trend signal)
          Both share chartMax for the Y scale — gridlines, labels, bars, and
          the average line are all aligned on the same coordinate system.
        */}
        <svg
          viewBox="0 0 620 220"
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Bar chart with 7-day trend line showing reports over the last 30 days"
        >
          <rect x="0" y="0" width="620" height="220" rx="14" className="chart-backdrop" />

          {/* Horizontal gridlines + Y-axis labels */}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1="44"
                y1={yForValue(tick)}
                x2="604"
                y2={yForValue(tick)}
                className="chart-grid-line"
              />
              <text x="38" y={yForValue(tick) + 4} className="chart-axis-label" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}

          {/* Daily bars — each anchored to the bottom baseline (y=186) */}
          {chartPoints.map((point) => {
            const barW = Math.min(point.slotWidth * 0.55, 12);
            return (
              <rect
                key={`bar-${point.date}`}
                x={point.x - barW / 2}
                y={point.y}
                width={barW}
                // Ensure a minimum 2 px pixel so zero-count days still show a
                // hairline rather than disappearing entirely.
                height={Math.max(point.barHeight, 2)}
                rx="3"
                className="chart-bar"
              >
                <title>{`${formatDayLabel(point.date)}: ${point.count} report${point.count === 1 ? "" : "s"}`}</title>
              </rect>
            );
          })}

          {/* 7-day average trend line — the primary signal layer */}
          {avgPolylinePoints && (
            <polyline points={avgPolylinePoints} className="line-series-average" />
          )}

          {/* X-axis date labels — weekly cadence, kept inside the viewBox bottom */}
          {xTicks.map((point) => (
            <text
              key={`x-${point.date}`}
              x={point.x}
              y="214"
              className="chart-axis-label"
              textAnchor="middle"
            >
              {formatDayLabel(point.date)}
            </text>
          ))}
        </svg>

        <div className="chart-legend">
          <span><i className="legend-dot daily" /> Daily reports</span>
          <span><i className="legend-dot avg" /> 7-day trend</span>
        </div>
        {!hasTrendData && (
          <p className="admin-empty">No report activity in the last 30 days yet.</p>
        )}
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
