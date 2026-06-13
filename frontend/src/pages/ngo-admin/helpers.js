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
 * Converts a 30-day report series from the backend into SVG (x, y) coordinate
 * objects for rendering the trend polyline.
 *
 * @param {{ date: string, count: number }[]} series
 * @returns {{ x: number, y: number, count: number, date: string }[]}
 */
export function buildLineChartPoints(series) {
  if (!series.length) return [];

  const width = 620;
  const height = 220;
  const padTop = 16;
  const padRight = 16;
  const padBottom = 34;
  const padLeft = 44;
  const max = Math.max(...series.map((item) => Number(item.count || 0)), 1);

  return series.map((item, index) => {
    const x = padLeft + (index * (width - padLeft - padRight)) / Math.max(series.length - 1, 1);
    const y = height - padBottom - ((Number(item.count || 0) / max) * (height - padTop - padBottom));
    return { x, y, count: Number(item.count || 0), date: item.date };
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
