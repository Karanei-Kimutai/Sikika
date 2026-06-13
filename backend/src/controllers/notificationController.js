/**
 * notificationController.js
 * -------------------------
 * Read-side API for the in-app notification center.
 *
 * The write side (fan-out) already exists in chatSocket.js, reportController.js,
 * and communityController.js. This controller exposes the complementary list,
 * mark-read, and dismiss endpoints so users can interact with their notifications.
 *
 * All queries are scoped to req.user.id (the authenticated user's recipientUserId).
 * Cross-user access is impossible by design — ownership is checked on every write.
 *
 * Discreet wording policy (SSD §22.2):
 *   Notification messages are stored with neutral, privacy-safe language.
 *   This controller does not create notification text — it only surfaces existing rows.
 *   See inAppNotification model comment for wording guidelines.
 */

const { InAppNotification } = require('../models');

// Maximum number of notifications returned in a single list request.
// Prevents unbounded payloads for users with many historical notifications.
const NOTIFICATION_LIST_LIMIT = 50;

/**
 * resolveRecipientId
 * ------------------
 * Extracts the authenticated user's ID from either JWT claim name.
 * The JWT payload carries both 'id' and 'userId' for backward compatibility.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function resolveRecipientId(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * listNotifications
 * -----------------
 * GET /api/notifications
 *
 * Returns the authenticated user's visible (non-dismissed) notifications,
 * newest first, capped at NOTIFICATION_LIST_LIMIT rows.
 *
 * Query parameters:
 *   ?unreadOnly=true  — restrict to UNREAD notifications only
 *
 * Response body:
 *   { notifications: [...], unreadCount: number, total: number }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function listNotifications(req, res) {
  try {
    const recipientUserId = resolveRecipientId(req);
    if (!recipientUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Build the WHERE clause — always exclude dismissed notifications.
    const where = {
      recipientUserId,
      notificationDismissedStatus: 'VISIBLE'
    };

    // Optional filter: only show UNREAD items (used by poll-for-badge endpoints).
    if (req.query.unreadOnly === 'true') {
      where.notificationReadStatus = 'UNREAD';
    }

    const notifications = await InAppNotification.findAll({
      where,
      order: [['notificationCreationTimestamp', 'DESC']],
      limit: NOTIFICATION_LIST_LIMIT
    });

    // Compute the unread count from the full visible set, not just this page,
    // so the header badge is always accurate even when the list is paginated.
    const unreadCount = await InAppNotification.count({
      where: {
        recipientUserId,
        notificationReadStatus: 'UNREAD',
        notificationDismissedStatus: 'VISIBLE'
      }
    });

    return res.json({
      notifications,
      unreadCount,
      total: notifications.length
    });
  } catch (error) {
    console.error('listNotifications error:', error);
    return res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
}

/**
 * getUnreadCount
 * --------------
 * GET /api/notifications/unread-count
 *
 * Lightweight endpoint for the header bell badge polling loop.
 * Returns only the integer count of UNREAD + VISIBLE notifications.
 * Intentionally minimal — no full notification payload — to keep
 * the poll response fast and small.
 *
 * Response body:
 *   { unreadCount: number }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function getUnreadCount(req, res) {
  try {
    const recipientUserId = resolveRecipientId(req);
    if (!recipientUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const unreadCount = await InAppNotification.count({
      where: {
        recipientUserId,
        notificationReadStatus: 'UNREAD',
        notificationDismissedStatus: 'VISIBLE'
      }
    });

    return res.json({ unreadCount });
  } catch (error) {
    console.error('getUnreadCount error:', error);
    return res.status(500).json({ error: 'Failed to retrieve notification count.' });
  }
}

/**
 * markRead
 * --------
 * PATCH /api/notifications/:notificationId/read
 *
 * Marks a single notification as READ. Returns 404 when the notification does not
 * exist OR belongs to a different user (ownership is enforced, not just existence).
 *
 * Idempotent: marking an already-READ notification is a no-op and returns 200.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function markRead(req, res) {
  try {
    const recipientUserId = resolveRecipientId(req);
    if (!recipientUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { notificationId } = req.params;

    // Scope the lookup to the authenticated user to prevent cross-user reads.
    const notification = await InAppNotification.findOne({
      where: { notificationId, recipientUserId }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    notification.notificationReadStatus = 'READ';
    await notification.save();

    return res.json({ message: 'Notification marked as read.', notificationId });
  } catch (error) {
    console.error('markRead error:', error);
    return res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
}

/**
 * markAllRead
 * -----------
 * PATCH /api/notifications/read-all
 *
 * Bulk marks all of the authenticated user's UNREAD + VISIBLE notifications as READ.
 * Used by the "Mark all as read" action in the notification panel header.
 *
 * Response body:
 *   { message: string, updated: number }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function markAllRead(req, res) {
  try {
    const recipientUserId = resolveRecipientId(req);
    if (!recipientUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const [updatedCount] = await InAppNotification.update(
      { notificationReadStatus: 'READ' },
      {
        where: {
          recipientUserId,
          notificationReadStatus: 'UNREAD',
          notificationDismissedStatus: 'VISIBLE'
        }
      }
    );

    return res.json({
      message: 'All notifications marked as read.',
      updated: updatedCount
    });
  } catch (error) {
    console.error('markAllRead error:', error);
    return res.status(500).json({ error: 'Failed to mark all notifications as read.' });
  }
}

/**
 * dismissNotification
 * -------------------
 * PATCH /api/notifications/:notificationId/dismiss
 *
 * Hides a notification from the default list by setting its dismissedStatus to
 * DISMISSED. The row is retained for audit continuity; it simply no longer
 * appears in listNotifications unless explicitly fetched.
 *
 * Dismiss is intentionally separate from read: a user may dismiss without
 * reading (quick mass-clear) or may read without dismissing (wants to see
 * the notification panel later). Both states are tracked independently.
 *
 * Returns 404 when the notification does not exist or belongs to another user.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function dismissNotification(req, res) {
  try {
    const recipientUserId = resolveRecipientId(req);
    if (!recipientUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { notificationId } = req.params;

    // Ownership check: users can only dismiss their own notifications.
    const notification = await InAppNotification.findOne({
      where: { notificationId, recipientUserId }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    notification.notificationDismissedStatus = 'DISMISSED';
    await notification.save();

    return res.json({ message: 'Notification dismissed.', notificationId });
  } catch (error) {
    console.error('dismissNotification error:', error);
    return res.status(500).json({ error: 'Failed to dismiss notification.' });
  }
}

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  dismissNotification
};
