const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * InAppNotification
 * -----------------
 * In-app notification delivered to a user after a system event.
 * ALL notification messages use discreet wording to protect survivor
 * safety — no mention of GBV, counselling, or platform purpose
 * (see SSD §22.2 Discreet Wording Policy).
 *
 * Relationships defined in models/index.js:
 *   - inAppNotification.belongsTo(userAccount, as: 'recipient')
 */
const InAppNotification = sequelize.define('inAppNotification', {
 
  notificationId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this notification'
  },
 
  recipientUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — the user who receives this notification'
  },
 
  /**
   * The event category that triggered this notification.
   * Used for filtering and grouping in the notification panel.
   * For example: NEW_MESSAGE | REPORT_UPDATE | ASSIGNMENT | MODERATION_ALERT
   */
  notificationCategoryType: {
    type:      DataTypes.STRING(30),
    allowNull: false,
    comment:   'Event category — e.g. NEW_MESSAGE, REPORT_UPDATE, ASSIGNMENT'
  },
 
  /**
   * The notification message text shown to the user.
   * MUST follow the discreet wording policy — see SSD §22.2.
   * Examples: "You have a new message." | "Your request has been updated."
   */
  discreetNotificationMessage: {
    type:      DataTypes.STRING(255),
    allowNull: false,
    comment:   'Discreet message text — must not expose platform purpose or GBV context'
  },
 
  /**
   * Whether the user has read this notification.
   * READ notifications are still stored — they are not auto-deleted.
   * Future: implement automatic deletion of old notifications.
   */
  notificationReadStatus: {
    type:         DataTypes.ENUM('UNREAD', 'READ'),
    defaultValue: 'UNREAD',
    comment:      'Read status — supports mark-as-read and mark-all-as-read'
  },

  /**
   * Dismiss state — distinct from read state (SSD §22.2 requirement).
   * DISMISSED notifications are hidden from the default list view but retained
   * in the database for audit continuity. A user can dismiss a notification
   * without necessarily having read it (e.g. quick mass-dismiss).
   *
   * The read/dismiss separation allows the notification center to show
   * "mark all as read" and separately offer "clear / dismiss all" without
   * conflating the two user intents.
   */
  notificationDismissedStatus: {
    type:         DataTypes.ENUM('VISIBLE', 'DISMISSED'),
    defaultValue: 'VISIBLE',
    comment:      'Dismiss state — DISMISSED hides the notification from the panel without deleting it'
  },

  notificationCreationTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this notification was created'
  },

  /**
   * The type of entity that triggered this notification (e.g. 'CHAT', 'REPORT',
   * 'COMMUNITY_ROOM', 'CALLBACK_REQUEST'). Paired with relatedEntityId so the
   * frontend can navigate the user straight to the relevant item on click.
   * Nullable — older rows and categories with no linkable entity leave this unset.
   */
  relatedEntityType: {
    type:      DataTypes.STRING(30),
    allowNull: true,
    comment:   'Entity type this notification refers to, e.g. CHAT, REPORT, COMMUNITY_ROOM, CALLBACK_REQUEST'
  },

  /**
   * The UUID of the entity referenced by relatedEntityType (chatId, reportId,
   * roomId, callbackRequestId, etc). Nullable for the same reasons as above.
   */
  relatedEntityId: {
    type:      DataTypes.STRING(36),
    allowNull: true,
    comment:   'UUID of the entity this notification refers to'
  }

}, {
  tableName: 'inAppNotification',
  comment:   'In-app notification — discreet wording enforced to protect survivor safety'
});

module.exports = InAppNotification;