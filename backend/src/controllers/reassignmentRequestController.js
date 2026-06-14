const { Op } = require('sequelize');
const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  StaffReassignmentRequest
} = require('../models');
const { applySurvivorReassignment } = require('./adminController');

/**
 * reassignmentRequestController
 * -----------------------------
 * Handles survivor-driven reassignment requests and NGO-admin review actions.
 *
 * Policy summary:
 * - Survivors can submit requests about their own staffing relationship.
 * - Only one pending request per survivor is allowed at a time.
 * - NGO admins review and can approve/reject with optional notes.
 * - Approval executes real staff reassignment via adminController helper.
 */

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

const { normalizeRole } = require('../utils/roles');

async function getActor(req) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId, {
    attributes: ['userId', 'userRole', 'accountStatus']
  });

  if (!user || user.accountStatus !== 'ACTIVE') return null;

  return {
    userId: user.userId,
    role: normalizeRole(user.userRole)
  };
}

async function getSurvivorProfileByUserId(userId) {
  return SurvivorProfile.findOne({
    where: { userId },
    attributes: ['survivorId', 'displayNickname', 'residenceCounty']
  });
}

function normalizeRequestedScope(value) {
  const scope = String(value || '').trim().toUpperCase();
  if (['COUNSELLOR', 'LEGAL_COUNSEL', 'BOTH'].includes(scope)) return scope;
  return null;
}

async function pickReplacementCounsellor(currentCounsellorId) {
  // Replacement policy: prefer AVAILABLE staff, sorted by lowest workload.
  // If only current counsellor is available, fallback allows same assignment
  // rather than failing, which keeps approval logic deterministic.
  const candidates = await CounsellorProfile.findAll({
    attributes: ['counsellorId', 'currentWorkloadScore', 'availabilityStatus'],
    order: [
      ['currentWorkloadScore', 'ASC'],
      ['counsellorId', 'ASC']
    ]
  });

  const filtered = candidates.filter((item) => item.availabilityStatus === 'AVAILABLE');
  const excludingCurrent = filtered.filter((item) => item.counsellorId !== currentCounsellorId);
  if (excludingCurrent.length > 0) return excludingCurrent[0].counsellorId;
  if (filtered.length > 0) return filtered[0].counsellorId;
  return null;
}

async function pickReplacementLegalCounsel(currentLegalCounselId) {
  // Mirrors counsellor replacement policy for legal counsel assignment.
  const candidates = await LegalCounselProfile.findAll({
    attributes: ['legalCounselId', 'currentWorkloadScore', 'availabilityStatus'],
    order: [
      ['currentWorkloadScore', 'ASC'],
      ['legalCounselId', 'ASC']
    ]
  });

  const filtered = candidates.filter((item) => item.availabilityStatus === 'AVAILABLE');
  const excludingCurrent = filtered.filter((item) => item.legalCounselId !== currentLegalCounselId);
  if (excludingCurrent.length > 0) return excludingCurrent[0].legalCounselId;
  if (filtered.length > 0) return filtered[0].legalCounselId;
  return null;
}

async function createMyReassignmentRequest(req, res) {
  // Survivor intake endpoint: validates scope + reason and enforces one pending request.
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SURVIVOR') {
      return res.status(403).json({ error: 'Only survivors can create reassignment requests.' });
    }

    const survivorProfile = await getSurvivorProfileByUserId(actor.userId);
    if (!survivorProfile) {
      return res.status(404).json({ error: 'Survivor profile not found.' });
    }

    const requestedScope = normalizeRequestedScope(req.body?.requestedScope || 'BOTH');
    const requestReasonText = String(req.body?.requestReasonText || '').trim();

    if (!requestedScope) {
      return res.status(400).json({ error: 'requestedScope must be COUNSELLOR, LEGAL_COUNSEL, or BOTH.' });
    }

    if (!requestReasonText) {
      return res.status(400).json({ error: 'requestReasonText is required.' });
    }

    if (requestReasonText.length < 8) {
      return res.status(400).json({ error: 'requestReasonText must be at least 8 characters.' });
    }

    const pendingExists = await StaffReassignmentRequest.findOne({
      where: {
        survivorId: survivorProfile.survivorId,
        requestStatus: 'PENDING'
      }
    });

    if (pendingExists) {
      return res.status(409).json({ error: 'You already have a pending reassignment request.' });
    }

    const request = await StaffReassignmentRequest.create({
      survivorId: survivorProfile.survivorId,
      requestedScope,
      requestReasonText
    });

    return res.status(201).json({
      message: 'Reassignment request submitted successfully.',
      request
    });
  } catch (error) {
    console.error('Create reassignment request error:', error);
    return res.status(500).json({ error: 'Failed to submit reassignment request.' });
  }
}

async function listMyReassignmentRequests(req, res) {
  // Survivor self-service timeline for request tracking and transparency.
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SURVIVOR') {
      return res.status(403).json({ error: 'Only survivors can access their reassignment requests.' });
    }

    const survivorProfile = await getSurvivorProfileByUserId(actor.userId);
    if (!survivorProfile) {
      return res.status(404).json({ error: 'Survivor profile not found.' });
    }

    const requests = await StaffReassignmentRequest.findAll({
      where: { survivorId: survivorProfile.survivorId },
      order: [['requestTimestamp', 'DESC']]
    });

    return res.json({ requests });
  } catch (error) {
    console.error('List my reassignment requests error:', error);
    return res.status(500).json({ error: 'Failed to load reassignment requests.' });
  }
}

async function cancelMyReassignmentRequest(req, res) {
  // Survivors can only cancel requests that are still pending review.
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SURVIVOR') {
      return res.status(403).json({ error: 'Only survivors can cancel reassignment requests.' });
    }

    const survivorProfile = await getSurvivorProfileByUserId(actor.userId);
    if (!survivorProfile) {
      return res.status(404).json({ error: 'Survivor profile not found.' });
    }

    const request = await StaffReassignmentRequest.findByPk(req.params.requestId);
    if (!request || request.survivorId !== survivorProfile.survivorId) {
      return res.status(404).json({ error: 'Reassignment request not found.' });
    }

    if (request.requestStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled.' });
    }

    request.requestStatus = 'CANCELLED';
    request.reviewTimestamp = new Date();
    await request.save();

    return res.json({ message: 'Request cancelled.', request });
  } catch (error) {
    console.error('Cancel reassignment request error:', error);
    return res.status(500).json({ error: 'Failed to cancel reassignment request.' });
  }
}

async function listNgoReassignmentRequests(req, res) {
  // NGO queue view with optional status filtering and survivor metadata hydration.
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') {
      return res.status(403).json({ error: 'Only NGO admins can access reassignment requests.' });
    }

    const status = String(req.query.status || 'PENDING').trim().toUpperCase();
    const where = {};

    if (status !== 'ALL') {
      where.requestStatus = status;
    }

    const requests = await StaffReassignmentRequest.findAll({
      where,
      order: [['requestTimestamp', 'DESC']]
    });

    const survivorIds = [...new Set(requests.map((item) => item.survivorId))];
    const survivors = await SurvivorProfile.findAll({
      where: { survivorId: { [Op.in]: survivorIds.length ? survivorIds : ['__none__'] } },
      attributes: ['survivorId', 'displayNickname', 'residenceCounty', 'userId'],
      raw: true
    });

    const survivorById = new Map(survivors.map((row) => [row.survivorId, row]));

    return res.json({
      requests: requests.map((item) => {
        const survivor = survivorById.get(item.survivorId);
        return {
          ...item.toJSON(),
          survivor: survivor
            ? {
                survivorId: survivor.survivorId,
                userId: survivor.userId,
                displayNickname: survivor.displayNickname,
                residenceCounty: survivor.residenceCounty
              }
            : null
        };
      })
    });
  } catch (error) {
    console.error('List NGO reassignment requests error:', error);
    return res.status(500).json({ error: 'Failed to load reassignment requests.' });
  }
}

async function reviewNgoReassignmentRequest(req, res) {
  // NGO review endpoint: approval can trigger actual survivor reassignment.
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') {
      return res.status(403).json({ error: 'Only NGO admins can review reassignment requests.' });
    }

    const request = await StaffReassignmentRequest.findByPk(req.params.requestId);
    if (!request) {
      return res.status(404).json({ error: 'Reassignment request not found.' });
    }

    if (request.requestStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending requests can be reviewed.' });
    }

    const requestStatus = String(req.body?.requestStatus || '').trim().toUpperCase();
    const ngoAdminReviewNote = String(req.body?.ngoAdminReviewNote || '').trim();

    if (!['APPROVED', 'REJECTED'].includes(requestStatus)) {
      return res.status(400).json({ error: 'requestStatus must be APPROVED or REJECTED.' });
    }

    request.requestStatus = requestStatus;
    request.ngoAdminReviewerUserId = actor.userId;
    request.ngoAdminReviewNote = ngoAdminReviewNote || null;
    request.reviewTimestamp = new Date();

    if (requestStatus === 'APPROVED') {
      const survivor = await SurvivorProfile.findByPk(request.survivorId, {
        attributes: ['survivorId', 'assignedCounsellorId', 'assignedLegalCounselId']
      });

      if (!survivor) {
        return res.status(404).json({ error: 'Linked survivor profile not found.' });
      }

      let counsellorId = survivor.assignedCounsellorId;
      let legalCounselId = survivor.assignedLegalCounselId;

      if (request.requestedScope === 'COUNSELLOR' || request.requestedScope === 'BOTH') {
        counsellorId = await pickReplacementCounsellor(survivor.assignedCounsellorId);
      }

      if (request.requestedScope === 'LEGAL_COUNSEL' || request.requestedScope === 'BOTH') {
        legalCounselId = await pickReplacementLegalCounsel(survivor.assignedLegalCounselId);
      }

      if (!counsellorId && (request.requestedScope === 'COUNSELLOR' || request.requestedScope === 'BOTH')) {
        return res.status(409).json({ error: 'No available counsellor found for reassignment.' });
      }

      if (!legalCounselId && (request.requestedScope === 'LEGAL_COUNSEL' || request.requestedScope === 'BOTH')) {
        return res.status(409).json({ error: 'No available legal counsel found for reassignment.' });
      }

      await applySurvivorReassignment({
        survivorId: request.survivorId,
        counsellorId,
        legalCounselId,
        // The reason string is captured in assignment history for auditability.
        reason: `Approved survivor request ${request.requestId}`
      });
    }

    await request.save();

    return res.json({
      message: `Reassignment request ${requestStatus.toLowerCase()} successfully.`,
      request
    });
  } catch (error) {
    console.error('Review NGO reassignment request error:', error);
    return res.status(500).json({ error: 'Failed to review reassignment request.' });
  }
}

module.exports = {
  createMyReassignmentRequest,
  listMyReassignmentRequests,
  cancelMyReassignmentRequest,
  listNgoReassignmentRequests,
  reviewNgoReassignmentRequest
};
