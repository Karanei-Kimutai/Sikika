const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * ResourceAccessEvent
 * -------------------
 * Tracks each access of a support resource so NGO admins can review
 * usage analytics (most accessed resources and category usage trends).
 */
const ResourceAccessEvent = sequelize.define('resourceAccessEvent', {

  /** Stable UUID primary key — used for idempotent event references in analytics. */
  accessEventId: {
    type:      DataTypes.STRING(36),
    primaryKey: true,
    allowNull: false,
    comment:   'UUID primary key for this access event'
  },

  /**
   * The resource that was opened.
   * CASCADE: access events are removed when the resource is deleted.
   */
  resourceId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to supportResource — the resource that was accessed'
  },

  /**
   * The user who accessed the resource.
   * NULL for anonymous visitors — the library is public, no login required.
   * SET NULL on user delete to preserve analytics without a dangling FK.
   */
  accessorUserId: {
    type:      DataTypes.STRING(36),
    allowNull: true,
    comment:   'FK to userAccount — NULL when an unauthenticated visitor opens the resource'
  },

  /**
   * Delivery channel for the access event.
   * Currently always "WEB". Reserved for future mobile or USSD channels.
   */
  accessChannel: {
    type:         DataTypes.STRING(40),
    allowNull:    false,
    defaultValue: 'WEB',
    comment:      'Delivery channel — WEB | (future: MOBILE_APP, USSD)'
  },

  /** UTC timestamp of the access event — used to compute analytics time windows. */
  accessTimestamp: {
    type:         DataTypes.DATE,
    allowNull:    false,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of the access event'
  }

}, {
  tableName:  'resourceAccessEvent',
  comment:    'Tracks each resource open — powers NGO dashboard usage analytics'
});

module.exports = ResourceAccessEvent;
