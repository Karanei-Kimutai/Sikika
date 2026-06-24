import { useEffect, useRef, useState } from "react";

const HIGHLIGHT_DURATION_MS = 2500;

/**
 * useReportHighlight
 * -------------------
 * Shared deep-link behavior for the three report views (Survivor/Staff/LegalCounsel):
 * once `reports` contains a card matching `highlightReportId` (read from
 * /reports?reportId=<id>, e.g. via a clicked notification), scrolls that card
 * into view and returns its id for a few seconds so the caller can apply a
 * highlight class. Consumed once — does not re-trigger on later report list
 * refreshes (mirrors the "deep-link wins exactly once" pattern in CommunityPage).
 *
 * @param {object[]} reports
 * @param {string} highlightReportId
 * @returns {string} the reportId to render with a highlight class, or "" when none
 */
export default function useReportHighlight(reports, highlightReportId) {
  const [highlightedId, setHighlightedId] = useState("");
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!highlightReportId || consumedRef.current) return;
    const match = reports.find((report) => report.reportId === highlightReportId);
    if (!match) return;

    consumedRef.current = true;

    // Deferred (rather than a synchronous setState in the effect body) so the
    // scroll-into-view runs after the highlighted card has actually painted.
    const activateTimeoutId = setTimeout(() => {
      setHighlightedId(highlightReportId);
      document.getElementById(`report-${highlightReportId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    const clearTimeoutId = setTimeout(() => setHighlightedId(""), HIGHLIGHT_DURATION_MS);

    return () => {
      clearTimeout(activateTimeoutId);
      clearTimeout(clearTimeoutId);
    };
  }, [reports, highlightReportId]);

  return highlightedId;
}
