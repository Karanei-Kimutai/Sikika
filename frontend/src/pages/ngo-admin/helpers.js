/**
 * helpers.js — Pure formatting and chart-math utilities shared across
 * NgoAdminDashboardPage section components.
 */

/** @param {*} value @returns {string} */
export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

/** @param {*} value @returns {string} */
export function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

/**
 * Returns the Tailwind-style pill class for a severity/priority value.
 * @param {string} value
 * @returns {string}
 */
export function priorityClass(value) {
  const severity = String(value || "").toUpperCase();
  if (severity === "CRITICAL" || severity === "HIGH") return "pill priority-high";
  if (severity === "MEDIUM") return "pill priority-medium";
  return "pill priority-low";
}

/**
 * Converts SNAKE_CASE or camelCase to "Title Case".
 * @param {string} value
 * @returns {string}
 */
export function prettifyLabel(value) {
  return String(value || "-")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Returns the CSS class for a staff availability value.
 * @param {string} value
 * @returns {string}
 */
export function availabilityClass(value) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "AVAILABLE") return "availability-pill available";
  if (normalized === "BUSY") return "availability-pill busy";
  return "availability-pill offline";
}

/**
 * Converts a 30-day report series from the backend into SVG coordinate objects
 * for rendering the trend chart.
 *
 * Each point carries the slot-centre x position plus bar geometry (y = top of
 * bar, barHeight = pixel height) so bar and line renderers both share the same
 * vertical scale without a separate internal max computation.
 *
 * @param {{ date: string, count: number }[]} series
 * @param {number} chartMax - Pre-computed rounded maximum (from the caller) so
 *   bars, gridlines, Y-axis labels, and the average line all use one scale.
 * @returns {{ x: number, y: number, barHeight: number, slotWidth: number, count: number, date: string }[]}
 */
export function buildLineChartPoints(series, chartMax) {
  if (!series.length) return [];

  const width     = 660;
  const height    = 260;
  const padTop    = 22;
  const padRight  = 12;
  const padBottom = 44;
  const padLeft   = 52;
  const plotWidth = width - padLeft - padRight;
  const slotWidth = plotWidth / series.length;
  // Fall back to the series max when the caller hasn't supplied chartMax yet.
  const effectiveMax = chartMax || Math.max(...series.map((item) => Number(item.count || 0)), 1);

  return series.map((item, index) => {
    // Centre of each day's horizontal slot — shared by bars and the average line.
    const x = padLeft + (index + 0.5) * slotWidth;
    const count = Number(item.count || 0);
    const barHeight =
      effectiveMax > 0 ? (count / effectiveMax) * (height - padTop - padBottom) : 0;
    // y is the top edge of the bar (SVG Y grows downward).
    const y = height - padBottom - barHeight;
    return { x, y, barHeight, slotWidth, count, date: item.date };
  });
}

/**
 * Computes a simple moving average over chart points.
 *
 * @param {{ x: number, y: number, count: number, date: string }[]} series
 * @param {number} [windowSize=7]
 * @returns {{ x: number, y: number, count: number, date: string, avg: number }[]}
 */
export function buildMovingAverage(series, windowSize = 7) {
  if (!series.length) return [];
  return series.map((point, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = series.slice(start, index + 1);
    const avg = slice.reduce((sum, item) => sum + Number(item.count || 0), 0) / slice.length;
    return { ...point, avg };
  });
}

/**
 * Builds a smooth SVG cubic-bezier path string through a list of {x, y}
 * points. Uses the mid-point of each segment as control-point handles, which
 * produces a visually natural curve without any overshoot.
 *
 * Shared by the Command Center's main trend chart (area + average line) and
 * its small KPI-card sparklines, so both read from one curve algorithm.
 *
 * @param {{ x: number, y: number }[]} pts
 * @returns {string}
 */
export function smoothLinePath(pts) {
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
 * Builds a tiny inline sparkline path (no axes/gridlines) for a KPI card,
 * scaled independently of the main trend chart's coordinate space.
 *
 * @param {{ date: string, count: number }[]} series
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function buildSparklinePath(series, width, height) {
  if (!series || series.length < 2) return "";
  const max = Math.max(...series.map((item) => Number(item.count || 0)), 1);
  const stepX = width / (series.length - 1);
  const pts = series.map((item, index) => ({
    x: index * stepX,
    y: height - (Number(item.count || 0) / max) * height
  }));
  return smoothLinePath(pts);
}
