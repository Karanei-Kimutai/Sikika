/**
 * notificationService.js
 * ----------------------
 * Centralised helper for writing in-app notifications and pushing them to
 * connected clients in real time via Socket.io.
 *
 * All three existing write paths (report status changes, direct-chat messages,
 * community moderation warnings) now go through this module so that:
 *  1. The DB write always happens regardless of socket availability.
 *  2. A `notification:new` socket event is emitted to the recipient's personal
 *     room (`user:<userId>`) when they have a live connection, letting the
 *     frontend badge update instantly instead of waiting for the 30-second poll.
 *
 * Socket.io integration
 * ---------------------
 * The module exposes `setNotificationIo(io)` which is called once at boot from
 * `backend/index.js`, after the Socket.io server is created. This mirrors the
 * `app.locals.io` pattern used by communityController and chatController.
 * If io is not yet set (e.g. during unit tests), the DB write still proceeds —
 * the socket emit is simply skipped with a warning.
 */

const { randomUUID } = require('crypto');
const { InAppNotification } = require('../models');

/** @type {import('socket.io').Server|null} */
let _io = null;

/**
 * setNotificationIo
 * -----------------
 * Registers the Socket.io server instance used for real-time push.
 * Called once during bootstrap (backend/index.js) after `io` is created.
 *
 * @param {import('socket.io').Server} io
 */
function setNotificationIo(io) {
  _io = io;
}

/**
 * createNotification
 * ------------------
 * Persists a single in-app notification and emits `notification:new` to the
 * recipient's Socket.io personal room if they are currently connected.
 *
 * Notification text must follow the discreet wording convention (SSD §22.2):
 * vague enough not to expose sensitive context in notification surfaces.
 *
 * @param {object} opts
 * @param {string} opts.recipientUserId  - UserAccount.userId of the recipient.
 * @param {string} opts.message          - Discreet notification message (≤255 chars).
 * @param {string} [opts.category]       - notificationCategoryType (default 'REPORT_UPDATE').
 * @returns {Promise<import('../models').InAppNotification>} The persisted row.
 */
async function createNotification({ recipientUserId, message, category = 'REPORT_UPDATE' }) {
  const notificationId = randomUUID();
  const createdAt = new Date();

  const notification = await InAppNotification.create({
    notificationId,
    recipientUserId,
    notificationCategoryType: category,
    discreetNotificationMessage: message,
    notificationReadStatus: 'UNREAD',
    notificationCreationTimestamp: createdAt
  });

  // Push to the recipient's personal socket room for zero-latency badge updates.
  // The `user:<userId>` room is joined by chatSocket.js on every authenticated
  // connect, so all role types (counsellors, survivors, staff) benefit from
  // real-time delivery when they have a chat socket open.
  if (_io) {
    _io.to(`user:${recipientUserId}`).emit('notification:new', {
      notificationId,
      category,
      message,
      createdAt: createdAt.toISOString()
    });
  } else {
    // io not yet wired — only expected during test runs or very early startup.
    console.warn('[notificationService] io not set; skipping real-time push for', notificationId);
  }

  return notification;
}

/**
 * createNotificationsBulk
 * -----------------------
 * Fan-out helper: writes one notification per recipient and pushes each via
 * socket in parallel. Failures in individual rows are swallowed so one bad
 * recipientUserId does not block the rest of the batch.
 *
 * @param {string[]} recipientUserIds - Array of UserAccount.userId values.
 * @param {string}   message          - Discreet notification message.
 * @param {string}   [category]       - notificationCategoryType.
 * @returns {Promise<void>}
 */
async function createNotificationsBulk(recipientUserIds, message, category = 'REPORT_UPDATE') {
  await Promise.all(
    recipientUserIds.map((recipientUserId) =>
      createNotification({ recipientUserId, message, category }).catch((err) =>
        console.error('[notificationService] bulk notify failed for', recipientUserId, err)
      )
    )
  );
}

module.exports = { setNotificationIo, createNotification, createNotificationsBulk };
