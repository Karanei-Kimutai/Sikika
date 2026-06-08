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
 
  notificationCreationTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this notification was created'
  }
 
}, {
  tableName: 'inAppNotification',
  comment:   'In-app notification — discreet wording enforced to protect survivor safety'
});

module.exports = InAppNotification;