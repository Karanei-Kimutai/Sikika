import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, HeartHandshake, Timer, Scale, Hash, MessagesSquare, ShieldAlert, Inbox,
  TrendingUp, TrendingDown
} from "lucide-react";
import {
  formatNumber, prettifyLabel, buildLineChartPoints, buildMovingAverage,
  smoothLinePath, buildSparklinePath
} from "./helpers";
import { staggerIn, countUp, fadeInUp, drawIn } from "../../utils/motion";

// ── Chart coordinate constants — must match buildLineChartPoints in helpers.js ──
const CHART_W = 660;
const CHART_H = 260;
const PAD_L   = 52;
const PAD_R   = 12;
const PAD_T   = 22;
const PAD_B   = 44;
/** Y-coordinate of the X-axis baseline in SVG space. */
const BASELINE = CHART_H - PAD_B;

/**
 * Maps a data value to an SVG Y-coordinate using the shared vertical scale.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function yForVal(value, max) {
  const norm = max > 0 ? Number(value || 0) / max : 0;
  return CHART_H - PAD_B - norm * (CHART_H - PAD_T - PAD_B);
}

/**
 * Formats a "YYYY-MM-DD" string as a short "Mon DD" label.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDayLabel(dateStr) {
  if (!dateStr) return "";
  const [, month, day] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(month) - 1] || ""} ${day}`;
}

/**
 * CommandCenterSection
 * --------------------
 * KPI stat cards + 30-day report trend chart + community metrics +
 * report breakdown by category/status/county.
 *
 * Chart design: a smooth gradient **area** through daily counts is the
 * primary signal layer; a thin overlaid bezier line shows the 7-day rolling
 * average as secondary context. A transparent interaction layer tracks
 * pointer/touch position to drive a snap-to-nearest-day crosshair + tooltip.
 * A visually-hidden data table exposes the same series to screen readers
 * (the SVG itself is decorative/aria-hidden to avoid duplicate announcements).
 *
 * @param {object}  props
 * @param {object}  props.overview           - dashboard.overview aggregation object.
 * @param {Array}   props.reportsOverTime     - 30-day dense series from the backend.
 * @param {object}  props.communityMetrics    - dashboard.communityMetrics object.
 * @param {object}  props.reportsBreakdown    - dashboard.reportsBreakdown object.
 */
export default function CommandCenterSection({ overview, reportsOverTime, communityMetrics, reportsBreakdown }) {

  // ── Shared Y scale ─────────────────────────────────────────────────────────
  const chartMax = useMemo(() => {
    const rawMax = Math.max(...(reportsOverTime || []).map((p) => Number(p.count || 0)), 1);
    const step = rawMax <= 5 ? 1 : rawMax <= 20 ? 2 : rawMax <= 50 ? 5 : 10;
    return Math.ceil(rawMax / step) * step;
  }, [reportsOverTime]);

  const chartPoints = useMemo(
    () => buildLineChartPoints(reportsOverTime || [], chartMax),
    [reportsOverTime, chartMax]
  );

  const movingAveragePoints = useMemo(() => buildMovingAverage(chartPoints), [chartPoints]);

  // ── Daily gradient area (primary signal) ────────────────────────────────────
  /**
   * `dailyLinePath` traces the smoothed daily counts directly (no averaging) —
   * the primary signal. `dailyAreaPath` closes that line to the baseline so it
   * can be filled with a gradient, replacing the previous 30-thin-bars layout.
   */
  const { dailyLinePath, dailyAreaPath } = useMemo(() => {
    if (!chartPoints.length) return { dailyLinePath: "", dailyAreaPath: "" };
    const pts = chartPoints.map((p) => ({ x: p.x, y: yForVal(p.count, chartMax) }));
    const linePath = smoothLinePath(pts);
    if (pts.length < 2) return { dailyLinePath: linePath, dailyAreaPath: "" };
    const last  = pts[pts.length - 1];
    const first = pts[0];
    const areaPath = `${linePath} L${last.x},${BASELINE} L${first.x},${BASELINE} Z`;
    return { dailyLinePath: linePath, dailyAreaPath: areaPath };
  }, [chartPoints, chartMax]);

  // ── 7-day average overlay (secondary signal, thin line only — no fill) ─────
  const avgLinePath = useMemo(() => {
    if (!movingAveragePoints.length) return "";
    const pts = movingAveragePoints.map((p) => ({ x: p.x, y: yForVal(p.avg, chartMax) }));
    return smoothLinePath(pts);
  }, [movingAveragePoints, chartMax]);

  // ── Derived chart metadata ─────────────────────────────────────────────────
  const hasTrendData = chartPoints.some((p) => p.count > 0);
  const trendTotal   = chartPoints.reduce((sum, p) => sum + Number(p.count || 0), 0);
  const peakPoint    = chartPoints.reduce((best, p) => {
    if (!best || p.count > best.count) return p;
    return best;
  }, null);

  // ── Y-axis ticks (0 → chartMax in up to 4 equal steps) ────────────────────
  // De-duplicated: when chartMax is small (e.g. 1), naive equal division can
  // repeat the same rounded value several times, which previously produced
  // duplicate React keys AND stacked, overlapping gridlines/labels.
  const yTicks = useMemo(() => {
    const intervals = 4;
    const raw = Array.from({ length: intervals + 1 }, (_, i) => Math.round((chartMax * i) / intervals));
    return Array.from(new Set(raw));
  }, [chartMax]);

  // ── X-axis tick labels (every 7th day + last day) ─────────────────────────
  // The trailing "last day" label is only added when it would land at least
  // 3 days past the final weekly tick — otherwise (e.g. a 30-day series ending
  // 1 day after a multiple-of-7 index) the two labels crowd/overlap.
  const xTicks = useMemo(() => {
    if (!chartPoints.length) return [];
    const weeklyTicks = chartPoints.filter((_, i) => i % 7 === 0);
    const lastIndex = chartPoints.length - 1;
    const lastWeeklyIndex = (weeklyTicks.length - 1) * 7;
    if (lastIndex - lastWeeklyIndex >= 3) {
      return [...weeklyTicks, chartPoints[lastIndex]];
    }
    return weeklyTicks;
  }, [chartPoints]);

  // ── Hover/touch interaction: snap-to-nearest-day crosshair + tooltip ──────
  const [hoverIndex, setHoverIndex] = useState(null);
  const hoveredPoint = hoverIndex != null ? chartPoints[hoverIndex] : null;
  const hoveredAvg   = hoverIndex != null ? movingAveragePoints[hoverIndex]?.avg : null;

  /**
   * Resolves a pointer/touch clientX to the nearest day index in chartPoints,
   * accounting for the SVG's responsive scaling (viewBox vs. rendered width).
   * @param {number} clientX
   * @param {DOMRect} svgRect
   */
  function resolveHoverIndex(clientX, svgRect) {
    if (!chartPoints.length) return null;
    const scaleX = CHART_W / svgRect.width;
    const localX = (clientX - svgRect.left) * scaleX;
    const slotWidth = chartPoints[0].slotWidth;
    const index = Math.floor((localX - PAD_L) / slotWidth);
    return Math.max(0, Math.min(chartPoints.length - 1, index));
  }

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    setHoverIndex(resolveHoverIndex(clientX, rect));
  };

  const handlePointerLeave = () => setHoverIndex(null);

  // Clamp the tooltip's horizontal position so it stays within the chart panel.
  const tooltipLeftPercent = hoveredPoint
    ? Math.min(94, Math.max(6, (hoveredPoint.x / CHART_W) * 100))
    : 0;

  const gridRef = useRef(null);
  const totalReportsRef = useRef(null);
  const activeSurvivorsRef = useRef(null);
  const avgResponseRef = useRef(null);
  const activeLegalCasesRef = useRef(null);
  const activeRoomsRef = useRef(null);
  const totalMessagesRef = useRef(null);
  const harmfulReportsRef = useRef(null);
  const dailyAreaRef = useRef(null);
  const dailyLineRef = useRef(null);
  const avgLineRef = useRef(null);

  // Light reveal for KPI cards once their data has loaded.
  useEffect(() => {
    if (!gridRef.current || !overview) return;
    const cards = gridRef.current.querySelectorAll('.admin-stat-card');
    if (!cards.length) return;
    const mm = staggerIn(cards, { y: 10, stagger: 0.06 });
    return () => mm.revert();
  }, [overview]);

  // Counts each KPI number up from 0 on load, mirroring the stagger entrance above.
  useEffect(() => {
    if (!overview) return;
    const mms = [
      totalReportsRef.current && countUp(totalReportsRef.current, overview.totalReports),
      activeSurvivorsRef.current && countUp(activeSurvivorsRef.current, overview.activeSurvivors),
      avgResponseRef.current && countUp(avgResponseRef.current, overview.averageResponseMinutes),
      activeLegalCasesRef.current && countUp(activeLegalCasesRef.current, overview.activeLegalCases)
    ].filter(Boolean);
    return () => mms.forEach((mm) => mm.revert());
  }, [overview]);

  useEffect(() => {
    if (!communityMetrics) return;
    const mms = [
      activeRoomsRef.current && countUp(activeRoomsRef.current, communityMetrics.activeRooms),
      totalMessagesRef.current && countUp(totalMessagesRef.current, communityMetrics.totalMessages),
      harmfulReportsRef.current && countUp(harmfulReportsRef.current, communityMetrics.harmfulContentReports)
    ].filter(Boolean);
    return () => mms.forEach((mm) => mm.revert());
  }, [communityMetrics]);

  // Draw-in reveal for the trend chart: the area fades in, the two stroke
  // layers trace themselves in. All gated through the shared reduced-motion
  // policy (instant final state when the user prefers no animation).
  useEffect(() => {
    if (!hasTrendData) return;
    const strokeTargets = [dailyLineRef.current, avgLineRef.current].filter(Boolean);
    const mms = [
      dailyAreaRef.current && fadeInUp(dailyAreaRef.current, { y: 0, duration: 0.6 }),
      strokeTargets.length && drawIn(strokeTargets, { duration: 1.1 })
    ].filter(Boolean);
    return () => mms.forEach((mm) => mm.revert());
    // Re-run whenever the underlying path geometry changes, not just on mount.
  }, [hasTrendData, dailyAreaPath, dailyLinePath, avgLinePath]);

  const reportTrendPercent = Number(overview?.reportTrendPercent || 0);
  const reportSparklinePath = useMemo(
    () => buildSparklinePath(reportsOverTime || [], 64, 22),
    [reportsOverTime]
  );

  return (
    <section className="admin-module-grid" aria-label="Command center metrics" ref={gridRef}>

      {/* ── KPI stat cards ─────────────────────────────────────────────── */}
      <article className="admin-stat-card">
        <div className="admin-stat-head">
          <span className="admin-stat-icon admin-stat-icon--reports"><FileText size={18} aria-hidden="true" /></span>
          {reportSparklinePath && (
            <svg className="stat-sparkline" viewBox="0 0 64 22" width="64" height="22" aria-hidden="true">
              <path d={reportSparklinePath} fill="none" stroke="var(--workspace-accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <h3>Total Reports</h3>
        <p className="admin-metric"><span ref={totalReportsRef}>0</span></p>
        <span className={`stat-delta ${reportTrendPercent >= 0 ? "up" : "down"}`}>
          {reportTrendPercent >= 0
            ? <TrendingUp size={13} aria-hidden="true" />
            : <TrendingDown size={13} aria-hidden="true" />}
          {Math.abs(reportTrendPercent)}% vs last month
        </span>
      </article>

      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--survivors"><HeartHandshake size={18} aria-hidden="true" /></span>
        <h3>Active Survivors</h3>
        <p className="admin-metric"><span ref={activeSurvivorsRef}>0</span></p>
        <span>Currently assigned and receiving support</span>
      </article>

      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--response"><Timer size={18} aria-hidden="true" /></span>
        <h3>Avg Response Time</h3>
        <p className="admin-metric"><span ref={avgResponseRef}>0</span> <small style={{ fontSize: "0.9rem", fontWeight: 700 }}>min</small></p>
        <span>
          First reply in direct chat
          {Number(overview?.averageResponseSampleCount || 0) > 0
            ? ` · ${formatNumber(overview.averageResponseSampleCount)} samples`
            : ""}
        </span>
      </article>

      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--legal"><Scale size={18} aria-hidden="true" /></span>
        <h3>Active Legal Cases</h3>
        <p className="admin-metric"><span ref={activeLegalCasesRef}>0</span></p>
        <span>Open and in-progress legal escalations</span>
      </article>

      {/* ── 30-day trend chart ─────────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <div className="chart-header">
          <h2>30-Day Case Trend</h2>
          <div className="chart-header-stats">
            <div className="chart-stat-chip">
              <span>Total this period</span>
              <strong>{formatNumber(trendTotal)}</strong>
            </div>
            <div className="chart-stat-chip">
              <span>Peak day</span>
              <strong>
                {peakPoint && peakPoint.count > 0
                  ? `${formatDayLabel(peakPoint.date)} · ${peakPoint.count}`
                  : "—"}
              </strong>
            </div>
          </div>
        </div>

        <figure className="trend-chart-wrap">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            style={{ display: "block", overflow: "visible" }}
          >
            <defs>
              {/* Gradient fill for the daily area — accent colour fading to translucent */}
              <linearGradient id="cc-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--workspace-accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0.02" />
              </linearGradient>
              {/* Clip to the chart plot area so strokes/fills don't spill past the axes */}
              <clipPath id="cc-chart-clip">
                <rect x={PAD_L} y={PAD_T} width={CHART_W - PAD_L - PAD_R} height={CHART_H - PAD_T - PAD_B + 2} />
              </clipPath>
            </defs>

            {/* Subtle rounded chart surface */}
            <rect x="0" y="0" width={CHART_W} height={CHART_H} rx="12" className="chart-backdrop" />

            {/* Horizontal gridlines + Y-axis labels */}
            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={PAD_L}
                  y1={yForVal(tick, chartMax)}
                  x2={CHART_W - PAD_R}
                  y2={yForVal(tick, chartMax)}
                  className="chart-grid-line"
                />
                <text
                  x={PAD_L - 6}
                  y={yForVal(tick, chartMax) + 4}
                  className="chart-axis-label"
                  textAnchor="end"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/* Daily gradient area — primary signal layer, replaces the old 30-bar layout */}
            {dailyAreaPath && (
              <path ref={dailyAreaRef} d={dailyAreaPath} fill="url(#cc-area-grad)" clipPath="url(#cc-chart-clip)" />
            )}

            {/* Daily line — crisp boundary of the area above, the primary signal */}
            {dailyLinePath && (
              <path
                ref={dailyLineRef}
                d={dailyLinePath}
                fill="none"
                stroke="var(--workspace-accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                clipPath="url(#cc-chart-clip)"
              />
            )}

            {/* 7-day rolling average — thin secondary overlay, de-emphasized */}
            {avgLinePath && (
              <path
                ref={avgLineRef}
                d={avgLinePath}
                fill="none"
                stroke="var(--chart-trend)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.85"
                clipPath="url(#cc-chart-clip)"
              />
            )}

            {/* Peak marker — always visible, independent of hover state */}
            {peakPoint && peakPoint.count > 0 && (
              <circle
                cx={peakPoint.x}
                cy={yForVal(peakPoint.count, chartMax)}
                r="4"
                className="trend-peak-dot"
              />
            )}

            {/* Hover crosshair + focus dot — visual only, events handled by the
                transparent interaction rect painted on top. */}
            {hoveredPoint && (
              <g className="trend-crosshair" aria-hidden="true">
                <line x1={hoveredPoint.x} y1={PAD_T} x2={hoveredPoint.x} y2={BASELINE} className="trend-crosshair-line" />
                <circle cx={hoveredPoint.x} cy={yForVal(hoveredPoint.count, chartMax)} r="4.5" className="trend-crosshair-dot" />
              </g>
            )}

            {/* X-axis date labels — weekly cadence + last day */}
            {xTicks.map((point) => (
              <text
                key={`x-${point.date}`}
                x={point.x}
                y={CHART_H - 6}
                className="chart-axis-label"
                textAnchor="middle"
              >
                {formatDayLabel(point.date)}
              </text>
            ))}

            {/* Transparent interaction layer — topmost so it always receives
                pointer/touch events; `fill="transparent"` (not "none") so the
                whole plot area is hit-testable, not just painted strokes. */}
            {hasTrendData && (
              <rect
                x={PAD_L}
                y={PAD_T}
                width={CHART_W - PAD_L - PAD_R}
                height={CHART_H - PAD_T - PAD_B}
                fill="transparent"
                onMouseMove={handlePointerMove}
                onMouseLeave={handlePointerLeave}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerLeave}
                style={{ cursor: "crosshair" }}
              />
            )}
          </svg>

          {hoveredPoint && (
            <div className="trend-tooltip" style={{ left: `${tooltipLeftPercent}%` }}>
              <strong>{formatDayLabel(hoveredPoint.date)}</strong>
              <span>{hoveredPoint.count} report{hoveredPoint.count === 1 ? "" : "s"}</span>
              {hoveredAvg != null && (
                <span className="trend-tooltip-avg">{Math.round(hoveredAvg * 10) / 10} avg</span>
              )}
            </div>
          )}

          {/* Screen-reader-only data table — the single accessible source of
              truth for this chart (the SVG above is aria-hidden to avoid
              announcing the same data twice in two different shapes). */}
          {hasTrendData && (
            <table className="sr-only">
              <caption>30-day report trend, daily counts and 7-day rolling average</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Reports</th><th scope="col">7-day average</th></tr>
              </thead>
              <tbody>
                {chartPoints.map((point, index) => (
                  <tr key={point.date}>
                    <td>{formatDayLabel(point.date)}</td>
                    <td>{point.count}</td>
                    <td>{Math.round((movingAveragePoints[index]?.avg ?? 0) * 10) / 10}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </figure>

        <div className="chart-legend">
          <span>
            <span className="legend-swatch swatch-bar" aria-hidden="true" />
            Daily reports
          </span>
          <span>
            <span className="legend-swatch swatch-avg" aria-hidden="true" />
            7-day average
          </span>
        </div>

        {!hasTrendData && (
          <p className="admin-empty"><Inbox size={18} aria-hidden="true" /> No report activity in the last 30 days yet.</p>
        )}
      </article>

      {/* ── Community watch metrics ────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Community Watch Metrics</h2>
        <div className="admin-panels two-col">
          <div className="admin-stat-card">
            <span className="admin-stat-icon admin-stat-icon--community"><Hash size={18} aria-hidden="true" /></span>
            <h3>Active Rooms</h3>
            <p className="admin-metric"><span ref={activeRoomsRef}>0</span></p>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-icon admin-stat-icon--community"><MessagesSquare size={18} aria-hidden="true" /></span>
            <h3>Total Community Messages</h3>
            <p className="admin-metric"><span ref={totalMessagesRef}>0</span></p>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-icon admin-stat-icon--harmful"><ShieldAlert size={18} aria-hidden="true" /></span>
            <h3>Harmful Content Reports</h3>
            <p className="admin-metric"><span ref={harmfulReportsRef}>0</span></p>
          </div>
        </div>
      </article>

      {/* ── Report breakdown ───────────────────────────────────────────── */}
      <article className="admin-panel full-span">
        <h2>Report Breakdown</h2>
        <div className="breakdown-grid">
          {[{
            key:      "category",
            title:    "By Category",
            rows:     reportsBreakdown?.byCategory || [],
            labelKey: "category"
          }, {
            key:      "status",
            title:    "By Status",
            rows:     reportsBreakdown?.byStatus || [],
            labelKey: "status"
          }, {
            key:      "county",
            title:    "By County",
            rows:     reportsBreakdown?.byCounty || [],
            labelKey: "county"
          }].map((group) => {
            const max = Math.max(...group.rows.map((row) => Number(row.count || 0)), 1);
            return (
              <article key={group.key} className="breakdown-card">
                <h3>{group.title}</h3>
                <ul className="breakdown-list">
                  {group.rows.map((row) => {
                    const rawLabel = row[group.labelKey];
                    const label    = group.key === "county"
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
