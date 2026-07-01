const express = require("express");
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");
const {
  createReport,
  listReports,
  getReport,
  updateOwnReport,
  withdrawReport,
  deleteOwnReport,
  updateReportStatus,
  getReportAnalytics,
  uploadEvidence,
  streamEvidenceFile
} = require("../controllers/reportController");

const router = express.Router();

// In-memory storage keeps the upload buffer in req.file.buffer without writing
// to disk. The controller streams it directly to Cloudinary. 15 MB ceiling
// is a per-file limit; the platform does not impose a per-report total.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

/**
 * Reporting API routes.
 *
 * Mounted at /api/reports from backend/index.js.
 * All endpoints require a valid JWT; role-based visibility and write
 * permissions are enforced inside each controller function.
 *
 * Route map:
 *   POST   /                                     → submit a new incident report (SURVIVOR)
 *   GET    /                                     → list reports (role-scoped: own for survivor, all for staff)
 *   GET    /analytics/summary                    → aggregate KPIs for the NGO dashboard (NGO_ADMIN)
 *   GET    /:reportId                            → fetch a single report with evidence and legal case
 *   PATCH  /:reportId                            → update mutable fields on own report (SURVIVOR)
 *   PATCH  /:reportId/withdraw                   → withdraw a report (SURVIVOR, own reports only)
 *   DELETE /:reportId                            → delete own report (SURVIVOR, SUBMITTED state only)
 *   PATCH  /:reportId/status                     → advance report through the status state machine (staff)
 *   POST   /:reportId/evidence                   → upload evidence file (multipart/form-data, 15 MB limit)
 *   GET    /:reportId/evidence/:evidenceId/file  → stream evidence file via Cloudinary proxy (JWT required)
 *
 * File upload config: multer in-memory storage, 15 MB per file.
 * Cloudinary delivery: evidence files are type:authenticated — backend proxy only,
 * no direct Cloudinary URLs reach the browser.
 */
router.use(authMiddleware);

// Submit a new incident report. Survior-role only; creates the report in SUBMITTED state.
router.post("/", createReport);

// List reports. Survivors see only their own; staff see reports for assigned survivors;
// NGO Admin sees all reports.
router.get("/", listReports);

// This route MUST come before /:reportId to avoid Express treating "analytics" as a param.
router.get("/analytics/summary", getReportAnalytics);

// Fetch a single report by ID with evidence files and linked legal case if any.
router.get("/:reportId", getReport);

// Update mutable fields on a SURVIVOR's own report (narrative, location, date).
// Cannot be used to change status — use /:reportId/status for that.
router.patch("/:reportId", updateOwnReport);

// Withdraw a report — transitions currentReportStatus to WITHDRAWN (survivor only).
router.patch("/:reportId/withdraw", withdrawReport);

// Hard-delete a report (SURVIVOR, SUBMITTED status only — once staff act, reports cannot be deleted).
router.delete("/:reportId", deleteOwnReport);

// Advance the report through the 7-state lifecycle (staff roles only).
// Legal case auto-creation fires on LEGAL_REVIEW and ESCALATED_TO_LEGAL_CASE transitions.
router.patch("/:reportId/status", updateReportStatus);

// Upload an evidence file and store it privately in Cloudinary.
// multer parses the multipart body into req.file; controller streams to Cloudinary.
router.post("/:reportId/evidence", upload.single("file"), uploadEvidence);

// Stream evidence file via backend proxy — Cloudinary signed URL generated server-side;
// raw URL never sent to the browser. Client fetches as blob and creates an object URL.
router.get("/:reportId/evidence/:evidenceId/file", streamEvidenceFile);

module.exports = router;
