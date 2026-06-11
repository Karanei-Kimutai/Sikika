const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  createMyReassignmentRequest,
  listMyReassignmentRequests,
  cancelMyReassignmentRequest,
  listNgoReassignmentRequests,
  reviewNgoReassignmentRequest
} = require('../controllers/reassignmentRequestController');

const router = express.Router();

/**
 * Reassignment request routes
 * ---------------------------
 * `/me/*` endpoints are survivor-owned request operations.
 * `/ngo/*` endpoints are NGO-admin review operations.
 *
 * The controller enforces role checks; this router focuses on endpoint shape.
 */
router.use(authMiddleware);

// Survivor: create/list/cancel their own reassignment requests.
router.get('/me', listMyReassignmentRequests);
router.post('/me', createMyReassignmentRequest);
router.patch('/me/:requestId/cancel', cancelMyReassignmentRequest);

// NGO admin: review queue and approve/reject pending requests.
router.get('/ngo', listNgoReassignmentRequests);
router.patch('/ngo/:requestId/review', reviewNgoReassignmentRequest);

module.exports = router;