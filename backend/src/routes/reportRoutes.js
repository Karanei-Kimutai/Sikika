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
  getEvidenceAccessUrl
} = require("../controllers/reportController");

const router = express.Router();

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
 * Role-based visibility is enforced inside controller methods.
 */
router.use(authMiddleware);

router.post("/", createReport);
router.get("/", listReports);
router.get("/analytics/summary", getReportAnalytics);
router.get("/:reportId", getReport);

router.patch("/:reportId", updateOwnReport);
router.patch("/:reportId/withdraw", withdrawReport);
router.delete("/:reportId", deleteOwnReport);

router.patch("/:reportId/status", updateReportStatus);
router.post("/:reportId/evidence", upload.single("file"), uploadEvidence);
router.get("/:reportId/evidence/:evidenceId/access-url", getEvidenceAccessUrl);

module.exports = router;
