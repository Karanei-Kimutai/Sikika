const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * ResourceAccessEvent
 * -------------------
 * Tracks each access of a support resource so NGO admins can review
 * usage analytics (most accessed resources and category usage trends).
 */
const ResourceAccessEvent = sequelize.define('resourceAccessEvent', {
  // Stable UUID for idempotent event references.
  accessEventId: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    allowNull: false
  },
  // Resource the user opened.
  resourceId: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  // Optional user id; null when visitor is anonymous.
  accessorUserId: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  // Channel marker for future expansion (e.g., WEB, MOBILE_APP).
  accessChannel: {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: 'WEB'
  },
  // Server-side event creation time used in analytics windows.
  accessTimestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'resourceAccessEvent'
});

module.exports = ResourceAccessEvent;
