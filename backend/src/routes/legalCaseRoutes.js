/**
 * legalCaseRoutes.js
 * ------------------
 * REST routes for legal counsel to draft and export formal legal case documents.
 *
 * All routes require:
 *  - A valid JWT (authMiddleware).
 *  - The caller to be a LEGAL_COUNSEL user assigned to the survivor whose case
 *    is being accessed (enforced in legalCaseController.resolveCaseForCounsel).
 *
 * Route map:
 *  PATCH  /api/legal-cases/:legalCaseId               → saveDraft
 *  PATCH  /api/legal-cases/:legalCaseId/status        → updateCaseStatus
 *  POST   /api/legal-cases/:legalCaseId/document      → generateDocument
 *  GET    /api/legal-cases/:legalCaseId/document      → streamDocument
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  saveDraft,
  updateCaseStatus,
  generateDocument,
  streamDocument
} = require('../controllers/legalCaseController');

// All legal-case endpoints require a verified session.
router.use(authMiddleware);

/**
 * Save or update draft authoring fields (summary, legal grounds, relief, actions).
 * Any subset of the four fields may be supplied; omitted fields are unchanged.
 */
router.patch('/:legalCaseId', saveDraft);

/**
 * Advance the case through its lifecycle:
 * OPEN → UNDER_INVESTIGATION → READY_FOR_SUBMISSION → SUBMITTED → CLOSED
 */
router.patch('/:legalCaseId/status', updateCaseStatus);

/**
 * Compile the current draft into a PDF and upload it privately to Cloudinary.
 * Populates generatedDocumentPath and documentGeneratedAt on the case record.
 */
router.post('/:legalCaseId/document', generateDocument);

/**
 * Stream the generated PDF directly to the client via the backend proxy.
 * The client fetches this with the Bearer token (responseType: blob) and
 * creates a local object URL — Cloudinary URLs never reach the browser.
 */
router.get('/:legalCaseId/document', streamDocument);

module.exports = router;
