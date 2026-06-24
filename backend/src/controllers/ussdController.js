const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const db = require('../models');
const { UssdCallbackRequest, UserAccount, CounsellorProfile } = db;
const { createNotification, createNotificationsBulk } = require('../services/notificationService');

/**
 * pickLeastLoadedCounsellor
 * --------------------------
 * Selects the counsellor with the lowest currentWorkloadScore, preferring
 * AVAILABLE staff, for auto-routing incoming USSD callback requests.
 *
 * Local to this controller (rather than reusing authController's
 * pickLeastLoadedStaff) to keep the unauthenticated USSD webhook path free
 * of authController's heavier module graph (JWT/bcrypt/Africa's Talking SDK
 * init) — this is the only staff-assignment logic this controller needs.
 *
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function pickLeastLoadedCounsellor() {
  const preferred = await CounsellorProfile.findOne({
    where: { availabilityStatus: { [Op.in]: ['AVAILABLE', 'BUSY'] } },
    order: [['currentWorkloadScore', 'ASC'], ['counsellorId', 'ASC']]
  });
  if (preferred) return preferred;

  return CounsellorProfile.findOne({
    order: [['currentWorkloadScore', 'ASC'], ['counsellorId', 'ASC']]
  });
}

/**
 * ussdController.js
 * -----------------
 * Handles Africa's Talking USSD session callbacks and the NGO admin
 * callback-request management workflow.
 *
 * USSD session lifecycle (Africa's Talking contract):
 *   - AT posts to POST /api/ussd/callback for every user interaction.
 *   - The `text` field accumulates all inputs for the session, joined by `*`.
 *   - Responses must be plain text prefixed with "CON " (continue) or
 *     "END " (terminate session). No JSON, no HTTP error codes.
 *
 * Menu tree:
 *   text = ""      → welcome screen (CON)
 *   text = "1"     → callback confirmation prompt (CON)
 *   text = "1*1"   → confirm callback → save record → END
 *   text = "1*0"   → cancel → END
 *   text = "2"     → emergency contacts listing → END
 *   any other      → invalid selection → END
 *
 * Security note: AT does not sign USSD requests, so this endpoint has no
 * authentication. It relies on the POST body fields being meaningless without
 * a valid AT session. A reverse-proxy IP allowlist is recommended in production.
 */

/**
 * Normalise the `text` field sent by Africa's Talking.
 * AT sends "" on the first interaction, then appends subsequent inputs
 * with "*" (e.g. "1*2*3"). We split and trim to get an array of steps.
 *
 * @param {string} rawText - The raw `text` field from the AT request body.
 * @returns {string[]} Ordered array of user input steps.
 */
function parseMenuPath(rawText) {
  if (!rawText || String(rawText).trim() === '') return [];
  return String(rawText)
    .split('*')
    .map((s) => s.trim());
}

/**
 * POST /api/ussd/callback
 *
 * Entry point for every Africa's Talking USSD interaction. Parses the
 * accumulated menu path and returns the appropriate CON/END response.
 * On confirmed callback selection it persists a UssdCallbackRequest row.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function handleCallback(req, res) {
  const { sessionId, phoneNumber, text } = req.body || {};

  // Guard: AT always provides these three fields. Drop malformed pings.
  if (!sessionId || !phoneNumber) {
    return res.type('text/plain').send('END An error occurred. Please try again.');
  }

  const steps = parseMenuPath(text);

  // ── Level 0: welcome screen ──────────────────────────────────────────────
  if (steps.length === 0) {
    return res.type('text/plain').send(
      'CON Welcome to Sikika\n' +
      '1. Request a callback\n' +
      '2. Emergency contacts'
    );
  }

  const root = steps[0];

  // ── Branch 1: callback request flow ─────────────────────────────────────
  if (root === '1') {
    // Level 1: ask for confirmation before saving
    if (steps.length === 1) {
      return res.type('text/plain').send(
        `CON Confirm callback request\n` +
        `We will contact you on ${phoneNumber}\n` +
        '1. Confirm\n' +
        '0. Cancel'
      );
    }

    const confirmation = steps[1];

    if (confirmation === '1') {
      // Persist the callback request — phone number only, no account required.
      try {
        // Auto-route to the least-loaded available counsellor so NGO Admin
        // doesn't have to manually triage every incoming callback. Best-effort:
        // a lookup failure should not block saving the request itself.
        const assignedCounsellor = await pickLeastLoadedCounsellor().catch((err) => {
          console.error('[USSD] Failed to auto-assign counsellor for callback:', err.message);
          return null;
        });

        const callbackRequestId = uuidv4();

        await UssdCallbackRequest.create({
          callbackRequestId,
          requesterPhoneNumber: phoneNumber,
          callbackFulfillmentStatus: 'PENDING',
          assignedCounsellorId: assignedCounsellor?.counsellorId || null
        });

        // Notify all active NGO admins of the new callback request in real time.
        // Best-effort — notification failure must not break the USSD flow.
        UserAccount.findAll({
          where: { role: 'NGO_ADMIN', accountStatus: 'ACTIVE' },
          attributes: ['userId']
        }).then((admins) => {
          if (!admins.length) return;
          const ids = admins.map((a) => a.userId);
          return createNotificationsBulk(
            ids,
            'A new callback request has been received via USSD.',
            'CALLBACK_REQUEST',
            'CALLBACK_REQUEST',
            callbackRequestId
          );
        }).catch((err) => {
          console.error('[USSD] Failed to notify NGO admins of callback request:', err.message);
        });

        // Notify the auto-assigned counsellor directly so they have visibility
        // into the callback without relying on the NGO admin to relay it.
        // Best-effort — notification failure must not break the USSD flow.
        if (assignedCounsellor?.userId) {
          createNotification({
            recipientUserId: assignedCounsellor.userId,
            message: 'A new callback request has been assigned to you.',
            category: 'CALLBACK_REQUEST',
            entityType: 'CALLBACK_REQUEST',
            entityId: callbackRequestId
          }).catch((err) => {
            console.error('[USSD] Failed to notify assigned counsellor of callback request:', err.message);
          });
        }

      } catch (err) {
        console.error('[USSD] Failed to save callback request:', err.message);
        return res.type('text/plain').send(
          'END We could not save your request. Please call 1195 directly.'
        );
      }

      return res.type('text/plain').send(
        'END Your callback request has been received.\n' +
        'Our support team will contact you shortly.'
      );
    }

    if (confirmation === '0') {
      return res.type('text/plain').send(
        'END Request cancelled. You can dial again any time.'
      );
    }

    // Unrecognised sub-selection
    return res.type('text/plain').send(
      'END Invalid selection. Please dial again.'
    );
  }

  // ── Branch 2: emergency contacts ─────────────────────────────────────────
  if (root === '2') {
    return res.type('text/plain').send(
      'END Emergency contacts:\n' +
      'Police: 999 or 112\n' +
      'Childline Kenya: 116\n' +
      'National GBV Hotline: 1195'
    );
  }

  // ── Fallback: unrecognised root selection ─────────────────────────────────
  return res.type('text/plain').send(
    'END Invalid selection. Please dial again.'
  );
}

/**
 * GET /api/ussd/callback-requests
 *
 * Returns all USSD callback requests, newest first.
 * Restricted to NGO_ADMIN role.
 *
 * @param {import('express').Request}  req  - Must have req.user from authMiddleware.
 * @param {import('express').Response} res
 */
async function listCallbackRequests(req, res) {
  if (req.user?.role !== 'NGO_ADMIN') {
    return res.status(403).json({ error: 'NGO admin access required.' });
  }

  try {
    const requests = await UssdCallbackRequest.findAll({
      order: [['callbackRequestTimestamp', 'DESC']]
    });

    // Resolve assigned-counsellor phone numbers for display — a single lookup
    // covering all rows rather than N+1 queries per request.
    const counsellorProfiles = await CounsellorProfile.findAll({
      attributes: ['counsellorId', 'userId'],
      include: [{ model: UserAccount, attributes: ['phoneNumber'] }]
    });
    const counsellorPhoneById = new Map(
      counsellorProfiles.map((profile) => [profile.counsellorId, profile.userAccount?.phoneNumber || null])
    );

    const enrichedRequests = requests.map((request) => ({
      ...request.toJSON(),
      assignedCounsellorPhone: counsellorPhoneById.get(request.assignedCounsellorId) || null
    }));

    return res.json({ requests: enrichedRequests });
  } catch (err) {
    console.error('[USSD] listCallbackRequests error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve callback requests.' });
  }
}

/**
 * GET /api/ussd/my-callback-requests
 *
 * Returns the USSD callback requests auto-assigned to the calling counsellor,
 * newest first. Restricted to COUNSELLOR role — gives the assigned counsellor
 * visibility into their own queue without the NGO-admin-wide view.
 *
 * @param {import('express').Request}  req  - Must have req.user from authMiddleware.
 * @param {import('express').Response} res
 */
async function getMyCallbackRequests(req, res) {
  if (req.user?.role !== 'COUNSELLOR') {
    return res.status(403).json({ error: 'Counsellor access required.' });
  }

  try {
    const counsellorProfile = await CounsellorProfile.findOne({
      where: { userId: req.user.userId },
      attributes: ['counsellorId']
    });

    if (!counsellorProfile) {
      return res.status(404).json({ error: 'Counsellor profile not found.' });
    }

    const requests = await UssdCallbackRequest.findAll({
      where: { assignedCounsellorId: counsellorProfile.counsellorId },
      order: [['callbackRequestTimestamp', 'DESC']]
    });

    return res.json({ requests });
  } catch (err) {
    console.error('[USSD] getMyCallbackRequests error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve your callback requests.' });
  }
}

/**
 * PATCH /api/ussd/callback-requests/:requestId
 *
 * Updates the fulfillment status of a USSD callback request.
 * Only COMPLETED and CANCELLED are valid next states from PENDING.
 * NGO_ADMIN may update any request; a COUNSELLOR may only update a request
 * that is auto-assigned to them.
 *
 * @param {import('express').Request}  req  - body: { callbackFulfillmentStatus }
 * @param {import('express').Response} res
 */
async function updateCallbackRequest(req, res) {
  const isAdmin = req.user?.role === 'NGO_ADMIN';
  const isCounsellor = req.user?.role === 'COUNSELLOR';

  if (!isAdmin && !isCounsellor) {
    return res.status(403).json({ error: 'NGO admin or assigned counsellor access required.' });
  }

  const { requestId } = req.params;
  const { callbackFulfillmentStatus } = req.body || {};

  const allowed = ['COMPLETED', 'CANCELLED'];
  if (!allowed.includes(callbackFulfillmentStatus)) {
    return res.status(400).json({
      error: `callbackFulfillmentStatus must be one of: ${allowed.join(', ')}.`
    });
  }

  try {
    const record = await UssdCallbackRequest.findByPk(requestId);

    if (!record) {
      return res.status(404).json({ error: 'Callback request not found.' });
    }

    if (isCounsellor) {
      // A counsellor may only act on a request auto-assigned to them — not
      // the NGO-admin-wide queue.
      const counsellorProfile = await CounsellorProfile.findOne({
        where: { userId: req.user.userId },
        attributes: ['counsellorId']
      });

      if (!counsellorProfile || record.assignedCounsellorId !== counsellorProfile.counsellorId) {
        return res.status(403).json({ error: 'This callback request is not assigned to you.' });
      }
    }

    if (record.callbackFulfillmentStatus !== 'PENDING') {
      return res.status(409).json({
        error: `Cannot update a request that is already ${record.callbackFulfillmentStatus}.`
      });
    }

    await record.update({ callbackFulfillmentStatus });

    return res.json({ message: 'Callback request updated.', request: record });
  } catch (err) {
    console.error('[USSD] updateCallbackRequest error:', err.message);
    return res.status(500).json({ error: 'Could not update callback request.' });
  }
}

module.exports = { handleCallback, listCallbackRequests, getMyCallbackRequests, updateCallbackRequest };
