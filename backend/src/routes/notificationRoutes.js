const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  dismissNotification
} = require('../controllers/notificationController');

const router = express.Router();

/**
 * Notification routes
 * -------------------
 * Mounted at /api/notifications.
 * All endpoints require a valid JWT via authMiddleware.
 * Controllers further scope every query to req.user.id so
 * users can only read and act on their own notifications.
 */
router.use(authMiddleware);

// List visible (non-dismissed) notifications for the authenticated user.
// Supports ?unreadOnly=true for the polling / badge queries.
router.get('/', listNotifications);

// Lightweight unread count endpoint — used by header bell badge polling.
// This route MUST be declared before /:notificationId to avoid route shadowing.
router.get('/unread-count', getUnreadCount);

// Mark a single notification as read (ownership enforced in controller).
router.patch('/:notificationId/read', markRead);

// Mark all of the caller's unread notifications as read.
router.patch('/read-all', markAllRead);

// Dismiss a single notification (hides it from the default panel list).
router.patch('/:notificationId/dismiss', dismissNotification);

module.exports = router;
