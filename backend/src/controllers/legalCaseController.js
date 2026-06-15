/**
 * legalCaseController.js
 * ----------------------
 * Dedicated endpoints for legal counsel to draft, manage, and export legal cases.
 *
 * Access model:
 * - All endpoints require authentication (authMiddleware applied at route level).
 * - Every operation resolves the calling user to a LegalCounselProfile and then
 *   verifies that the target case belongs to a survivor currently assigned to
 *   that counsel — mirroring reportController.canActorAccessReport for LEGAL_COUNSEL.
 * - Only LEGAL_COUNSEL role is allowed; all other roles receive 403.
 *
 * Endpoints:
 *   PATCH  /api/legal-cases/:legalCaseId           saveDraft
 *   PATCH  /api/legal-cases/:legalCaseId/status    updateCaseStatus
 *   POST   /api/legal-cases/:legalCaseId/document  generateDocument
 *   GET    /api/legal-cases/:legalCaseId/document  streamDocument
 *
 * Manual handover note:
 * - This platform never contacts law enforcement, courts, or any external party.
 * - The generated PDF is a handover artifact authored and submitted manually by counsel.
 */

const {
  LegalCaseFile,
  SurvivorProfile,
  LegalCounselProfile,
  UserAccount
} = require('../models');
const {
  isCloudinaryConfigured,
  uploadLegalDocumentBuffer,
  fetchPrivateAssetStream
} = require('../config/cloudinary');
const { buildLegalCasePdfBuffer } = require('../services/legalDocumentService');
const { normalizeRole } = require('../utils/roles');

/**
 * Extracts the userId from the verified JWT payload attached by authMiddleware.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function getUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * Resolves the calling user to an authenticated LEGAL_COUNSEL actor context.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{userId: string, role: string, legalCounselId: string}|null>}
 */
async function getLegalCounselActor(req) {
  const userId = getUserId(req);
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId, { attributes: ['userId', 'userRole'] });
  if (!user) return null;

  const role = normalizeRole(user.userRole);
  if (role !== 'LEGAL_COUNSEL') return null;

  const profile = await LegalCounselProfile.findOne({ where: { userId } });
  if (!profile) return null;

  return { userId, role, legalCounselId: profile.legalCounselId };
}

/**
 * Resolves a LegalCaseFile by ID and verifies the calling counsel is assigned
 * to the survivor linked to that case.
 *
 * Returns the case with its associated IncidentReport report summary fields.
 *
 * @param {string} legalCaseId
 * @param {string} legalCounselId - The caller's legalCounselId.
 * @returns {Promise<import('../models').LegalCaseFile|null>} null if not found or unauthorized.
 */
async function resolveCaseForCounsel(legalCaseId, legalCounselId) {
  const legalCase = await LegalCaseFile.findByPk(legalCaseId);
  if (!legalCase) return null;

  // Verify that the survivor linked to this case is assigned to this counsel.
  const { IncidentReport } = require('../models');
  const report = await IncidentReport.findByPk(legalCase.reportId, {
    attributes: ['reportId', 'survivorId', 'incidentCategory', 'severityLevel', 'incidentDate', 'incidentLocation']
  });
  if (!report) return null;

  const survivor = await SurvivorProfile.findOne({
    where: {
      survivorId: report.survivorId,
      assignedLegalCounselId: legalCounselId
    }
  });

  if (!survivor) return null;

  // Attach the report data for PDF rendering without a second query in callers.
  legalCase._reportData = {
    reportId: report.reportId,
    category: report.incidentCategory,
    severityLevel: report.severityLevel,
    date: report.incidentDate,
    location: report.incidentLocation
  };

  return legalCase;
}

/**
 * ALLOWED case-status transitions for legal counsel.
 * Terminal states: SUBMITTED and CLOSED.
 */
const CASE_STATUS_TRANSITIONS = {
  OPEN:                  ['UNDER_INVESTIGATION'],
  UNDER_INVESTIGATION:   ['READY_FOR_SUBMISSION'],
  READY_FOR_SUBMISSION:  ['SUBMITTED'],
  SUBMITTED:             ['CLOSED'],
  CLOSED:                []
};

// ── Endpoint handlers ────────────────────────────────────────────────────────

/**
 * saveDraft
 * ---------
 * Saves one or more of the four structured authoring fields for a legal case.
 *
 * Idempotent — fields not present in the request body are left unchanged.
 * Sets `draftLastUpdatedAt` on every call.
 *
 * @route PATCH /api/legal-cases/:legalCaseId
 */
const saveDraft = async (req, res) => {
  try {
    const actor = await getLegalCounselActor(req);
    if (!actor) {
      return res.status(403).json({ error: 'This action requires a Legal Counsel account.' });
    }

    const { legalCaseId } = req.params;
    const legalCase = await resolveCaseForCounsel(legalCaseId, actor.legalCounselId);
    if (!legalCase) {
      return res.status(404).json({ error: 'Legal case not found or you are not authorised to access it.' });
    }

    // Accepted authoring fields — only update what is explicitly provided.
    const ALLOWED_FIELDS = ['caseSummary', 'legalGroundsText', 'requestedReliefText', 'recommendedActionsText'];
    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        // Allow empty strings to clear a field; coerce non-strings to string.
        updates[field] = String(req.body[field]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No recognised draft fields were provided.' });
    }

    updates.draftLastUpdatedAt = new Date();

    await legalCase.update(updates);

    return res.json({
      message: 'Draft saved successfully.',
      legalCase: {
        legalCaseId: legalCase.legalCaseId,
        caseSummary: legalCase.caseSummary,
        legalGroundsText: legalCase.legalGroundsText,
        requestedReliefText: legalCase.requestedReliefText,
        recommendedActionsText: legalCase.recommendedActionsText,
        draftLastUpdatedAt: legalCase.draftLastUpdatedAt
      }
    });
  } catch (err) {
    console.error('saveDraft error:', err);
    return res.status(500).json({ error: 'Failed to save legal case draft.' });
  }
};

/**
 * updateCaseStatus
 * ----------------
 * Advances the legal case to the next lifecycle status.
 *
 * Valid transitions are defined in CASE_STATUS_TRANSITIONS. Attempting to
 * skip steps or revert to a previous status is rejected with 400.
 *
 * @route PATCH /api/legal-cases/:legalCaseId/status
 * @body {{ status: string }} - Target status value.
 */
const updateCaseStatus = async (req, res) => {
  try {
    const actor = await getLegalCounselActor(req);
    if (!actor) {
      return res.status(403).json({ error: 'This action requires a Legal Counsel account.' });
    }

    const { legalCaseId } = req.params;
    const legalCase = await resolveCaseForCounsel(legalCaseId, actor.legalCounselId);
    if (!legalCase) {
      return res.status(404).json({ error: 'Legal case not found or you are not authorised to access it.' });
    }

    const nextStatus = String(req.body?.status || '').trim().toUpperCase();
    if (!nextStatus) {
      return res.status(400).json({ error: 'status is required.' });
    }

    const allowedNext = CASE_STATUS_TRANSITIONS[legalCase.currentCaseStatus] || [];
    if (!allowedNext.includes(nextStatus)) {
      return res.status(400).json({
        error: `Cannot transition from ${legalCase.currentCaseStatus} to ${nextStatus}. Allowed next: ${allowedNext.join(', ') || 'none (terminal state).'}`
      });
    }

    await legalCase.update({ currentCaseStatus: nextStatus });

    return res.json({
      message: `Case status updated to ${nextStatus}.`,
      legalCase: {
        legalCaseId: legalCase.legalCaseId,
        currentCaseStatus: legalCase.currentCaseStatus
      }
    });
  } catch (err) {
    console.error('updateCaseStatus error:', err);
    return res.status(500).json({ error: 'Failed to update legal case status.' });
  }
};

/**
 * generateDocument
 * ----------------
 * Compiles the drafted authoring fields into a PDF and uploads it privately
 * to Cloudinary. Stores the Cloudinary public_id in `generatedDocumentPath`
 * and records `documentGeneratedAt`.
 *
 * Requires Cloudinary to be configured. Returns 503 if it is not (mirrors the
 * evidence upload guard pattern).
 *
 * @route POST /api/legal-cases/:legalCaseId/document
 */
const generateDocument = async (req, res) => {
  try {
    const actor = await getLegalCounselActor(req);
    if (!actor) {
      return res.status(403).json({ error: 'This action requires a Legal Counsel account.' });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        error: 'Document generation is not available — Cloudinary is not configured. Contact your system administrator.'
      });
    }

    const { legalCaseId } = req.params;
    const legalCase = await resolveCaseForCounsel(legalCaseId, actor.legalCounselId);
    if (!legalCase) {
      return res.status(404).json({ error: 'Legal case not found or you are not authorised to access it.' });
    }

    // Render the PDF in memory from the current draft state.
    const pdfBuffer = await buildLegalCasePdfBuffer(legalCase.toJSON(), legalCase._reportData);

    // Upload the PDF as a private Cloudinary raw asset.
    const uploadResult = await uploadLegalDocumentBuffer({ buffer: pdfBuffer, legalCaseId });

    // Persist the Cloudinary public_id so we can generate signed URLs later.
    await legalCase.update({
      generatedDocumentPath: uploadResult.public_id,
      documentGeneratedAt: new Date()
    });

    return res.json({
      message: 'Legal case document generated successfully.',
      documentGeneratedAt: legalCase.documentGeneratedAt,
      legalCaseId
    });
  } catch (err) {
    console.error('generateDocument error:', err);
    return res.status(500).json({ error: 'Failed to generate legal case document.' });
  }
};

/**
 * streamDocument
 * --------------
 * Streams the generated legal-case PDF directly to the client via the backend.
 *
 * The PDF is stored as a private Cloudinary asset (`type: authenticated`).
 * Signed delivery URLs are blocked by account-level restrictions, so we fetch
 * the file server-side using API credentials and pipe the bytes to the response.
 * The client fetches this endpoint with the Bearer token (responseType: blob)
 * and creates a local object URL — Cloudinary URLs never reach the browser.
 *
 * All response headers (Content-Type, Content-Disposition, Content-Length) are
 * set before piping so no chunk is flushed before headers are sent.
 *
 * @route GET /api/legal-cases/:legalCaseId/document
 */
const streamDocument = async (req, res) => {
  try {
    const actor = await getLegalCounselActor(req);
    if (!actor) {
      return res.status(403).json({ error: 'This action requires a Legal Counsel account.' });
    }

    const { legalCaseId } = req.params;
    const legalCase = await resolveCaseForCounsel(legalCaseId, actor.legalCounselId);
    if (!legalCase) {
      return res.status(404).json({ error: 'Legal case not found or you are not authorised to access it.' });
    }

    if (!legalCase.generatedDocumentPath) {
      return res.status(404).json({
        error: 'No document has been generated for this case yet. Use POST /document to generate one first.'
      });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ error: 'Document streaming is not available — Cloudinary is not configured.' });
    }

    const { stream, contentLength } = await fetchPrivateAssetStream({
      publicId: legalCase.generatedDocumentPath,
      resourceType: 'raw'
    });

    // Set all headers before piping so they are guaranteed to reach the client.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="legal-case-${legalCaseId}.pdf"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Propagate mid-stream Cloudinary errors so the socket is cleaned up.
    stream.on('error', (streamErr) => {
      console.error('[legal-case] Cloudinary stream error:', streamErr.message);
      res.destroy(streamErr);
    });

    stream.pipe(res);
  } catch (err) {
    console.error('streamDocument error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to stream legal case document.' });
    }
  }
};

module.exports = {
  saveDraft,
  updateCaseStatus,
  generateDocument,
  streamDocument
};
