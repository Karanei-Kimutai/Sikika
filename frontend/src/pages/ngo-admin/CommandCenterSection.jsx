import { useEffect, useMemo, useRef } from "react";
import { FileWarning, Users, Clock, Scale, Hash, MessagesSquare, ShieldAlert, Inbox } from "lucide-react";
import { formatNumber, prettifyLabel, buildLineChartPoints, buildMovingAverage } from "./helpers";
import { staggerIn, countUp } from "../../utils/motion";

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
 * Builds a smooth SVG cubic-bezier path string through a list of {x, y} points.
 * Uses the mid-point of each segment as control-point handles, which produces
 * a visually natural curve without any overshoot.
 *
 * @param {{ x: number, y: number }[]} pts
 * @returns {string}
 */
function smoothLinePath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C${cpx},${pts[i - 1].y} ${cpx},${pts[i].y} ${pts[i].x},${pts[i].y}`;
  }
  return d;
}

/**
 * CommandCenterSection
 * --------------------
 * KPI stat cards + 30-day report trend chart + community metrics +
 * report breakdown by category/status/county.
 *
 * Chart design: gradient-filled **bars** show daily granularity; a smooth
 * bezier **area + line** layer on top shows the 7-day rolling average. Both
 * share one vertical scale (chartMax) so gridlines, labels, bars, and the
 * trend are pixel-aligned.
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

  // ── Smooth bezier trend paths ───────────────────────────────────────────────
  /**
   * `trendLinePath` — smooth bezier path for the 7-day average line.
   * `trendAreaPath` — same path closed at the baseline to create a fill region.
   */
  const { trendLinePath, trendAreaPath } = useMemo(() => {
    if (!movingAveragePoints.length) return { trendLinePath: "", trendAreaPath: "" };
    const pts = movingAveragePoints.map((p) => ({
      x: p.x,
      y: yForVal(p.avg, chartMax)
    }));
    const linePath = smoothLinePath(pts);
    if (pts.length < 2) return { trendLinePath: linePath, trendAreaPath: "" };
    const last  = pts[pts.length - 1];
    const first = pts[0];
    const areaPath = `${linePath} L${last.x},${BASELINE} L${first.x},${BASELINE} Z`;
    return { trendLinePath: linePath, trendAreaPath: areaPath };
  }, [movingAveragePoints, chartMax]);

  // ── Derived chart metadata ─────────────────────────────────────────────────
  const hasTrendData = chartPoints.some((p) => p.count > 0);
  const trendTotal   = chartPoints.reduce((sum, p) => sum + Number(p.count || 0), 0);
  const peakPoint    = chartPoints.reduce((best, p) => {
    if (!best || p.count > best.count) return p;
    return best;
  }, null);

  // ── Y-axis ticks (0 → chartMax in 4 equal steps) ──────────────────────────
  const yTicks = useMemo(() => {
    const intervals = 4;
    return Array.from({ length: intervals + 1 }, (_, i) => Math.round((chartMax * i) / intervals));
  }, [chartMax]);

  // ── X-axis tick labels (every 7th day + last day) ─────────────────────────
  const xTicks = useMemo(() => {
    if (!chartPoints.length) return [];
    return chartPoints.filter((_, i) => i % 7 === 0 || i === chartPoints.length - 1);
  }, [chartPoints]);

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

  const gridRef = useRef(null);
  const totalReportsRef = useRef(null);
  const activeSurvivorsRef = useRef(null);
  const avgResponseRef = useRef(null);
  const activeLegalCasesRef = useRef(null);
  const activeRoomsRef = useRef(null);
  const totalMessagesRef = useRef(null);
  const harmfulReportsRef = useRef(null);

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

  return (
    <section className="admin-module-grid" aria-label="Command center metrics" ref={gridRef}>

      {/* ── KPI stat cards ─────────────────────────────────────────────── */}
      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--reports"><FileWarning size={18} aria-hidden="true" /></span>
        <h3>Total Reports</h3>
        <p className="admin-metric"><span ref={totalReportsRef}>0</span></p>
        <span className={`trend ${Number(overview?.reportTrendPercent || 0) >= 0 ? "up" : "down"}`}>
          {Number(overview?.reportTrendPercent || 0) >= 0 ? "▲" : "▼"}{" "}
          {Math.abs(Number(overview?.reportTrendPercent || 0))}% vs last month
        </span>
      </article>

      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--survivors"><Users size={18} aria-hidden="true" /></span>
        <h3>Active Survivors</h3>
        <p className="admin-metric"><span ref={activeSurvivorsRef}>0</span></p>
        <span>Currently assigned and receiving support</span>
      </article>

      <article className="admin-stat-card">
        <span className="admin-stat-icon admin-stat-icon--response"><Clock size={18} aria-hidden="true" /></span>
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

        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Bar chart with 7-day rolling average showing reports over the last 30 days"
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            {/* Gradient fills for bars — vertical, accent colour fading to translucent */}
            <linearGradient id="ngo-bar-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--workspace-accent)" stopOpacity="0.82" />
              <stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0.22" />
            </linearGradient>
            {/* Peak day bar gets a brighter, fully-opaque gradient */}
            <linearGradient id="ngo-peak-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--chart-peak)" stopOpacity="1"    />
              <stop offset="100%" stopColor="var(--chart-peak-soft)" stopOpacity="0.55" />
            </linearGradient>
            {/* Area fill under the trend line — green with heavy fade to bottom */}
            <linearGradient id="ngo-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--chart-trend)" stopOpacity="0.20" />
              <stop offset="70%"  stopColor="var(--chart-trend)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--chart-trend)" stopOpacity="0"    />
            </linearGradient>
            {/* Clip to the chart plot area so the trend line / area don't spill */}
            <clipPath id="ngo-chart-clip">
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

          {/* Daily bars with gradient fill; peak bar uses a brighter gradient */}
          {chartPoints.map((point) => {
            const isPeak = peakPoint && point.date === peakPoint.date && point.count > 0;
            const barW   = Math.min(point.slotWidth * 0.62, 15);
            return (
              <rect
                key={`bar-${point.date}`}
                x={point.x - barW / 2}
                y={point.y}
                width={barW}
                height={Math.max(point.barHeight, 2)}
                rx="3.5"
                fill={isPeak ? "url(#ngo-peak-grad)" : "url(#ngo-bar-grad)"}
                className="chart-bar"
              >
                <title>{`${formatDayLabel(point.date)}: ${point.count} report${point.count === 1 ? "" : "s"}`}</title>
              </rect>
            );
          })}

          {/* Gradient fill area below the rolling-average curve */}
          {trendAreaPath && (
            <path
              d={trendAreaPath}
              fill="url(#ngo-area-grad)"
              clipPath="url(#ngo-chart-clip)"
            />
          )}

          {/* Smooth bezier trend line — the primary signal layer */}
          {trendLinePath && (
            <path
              d={trendLinePath}
              fill="none"
              stroke="var(--chart-trend)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath="url(#ngo-chart-clip)"
            />
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
        </svg>

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
