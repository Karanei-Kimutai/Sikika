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

router.use(authMiddleware);

router.get('/me', listMyReassignmentRequests);
router.post('/me', createMyReassignmentRequest);
router.patch('/me/:requestId/cancel', cancelMyReassignmentRequest);

router.get('/ngo', listNgoReassignmentRequests);
router.patch('/ngo/:requestId/review', reviewNgoReassignmentRequest);

module.exports = router;