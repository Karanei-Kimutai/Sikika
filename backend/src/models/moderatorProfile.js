/**
 * moderatorProfile.js
 * --------------------
 * Sequelize model for the `moderatorProfile` table.
 *
 * Stores moderator-specific attributes. Every user with role MODERATOR
 * has exactly one row here. Moderators handle the community Moderation
 * Desk (reports queue, warnings, bans) and Community Chat oversight —
 * a delegated subset of NGO Admin responsibilities.
 *
 * The moderation queue itself is a shared pull queue (no per-report
 * assignee), so currentWorkloadScore is a capacity-visibility counter —
 * incremented whenever a moderator takes an action in reviewReport() —
 * rather than a routing input like counsellor/legal counsel workload.
 *
 * Relationships defined in models/index.js:
 *   - moderatorProfile.belongsTo(userAccount)
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ModeratorProfile = sequelize.define('moderatorProfile', {

  moderatorId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this moderator profile'
  },

  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one moderator profile per user account'
  },

  /**
   * Count of moderation actions (ban/warn/delete) taken by this moderator.
   * Surfaced in the dashboard for workload distribution visibility — not
   * used to route incoming reports, since the queue is shared/pull-based.
   */
  currentWorkloadScore: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
    comment:      'Moderation actions taken — capacity visibility, not queue routing'
  }

}, {
  tableName: 'moderatorProfile',
  comment:   'Moderator-specific profile — extends userAccount for MODERATOR role users'
});

module.exports = ModeratorProfile;
