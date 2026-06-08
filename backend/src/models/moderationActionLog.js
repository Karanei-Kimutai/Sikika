const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * ModerationActionLog
 * -------------------
 * Immutable audit record of every moderation action taken on the platform.
 * All warnings, suspensions, and message deletions are logged here.
 * Provides accountability and allows NGO Admin to audit moderator behaviour.
 *
 * Relationships defined in models/index.js:
 *   - moderationActionLog.belongsTo(userAccount, as: 'moderator')
 *   - moderationActionLog.belongsTo(userAccount, as: 'targetUser')
 */
const ModerationActionLog = sequelize.define('moderationActionLog', {
 
  moderationActionId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this moderation action record'
  },
 
  /**
   * The moderator who took the action — can be a counsellor,
   * legal counsel, or NGO Admin.
   */
  moderatorUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — moderator who took the action'
  },
 
  /**
   * The user the action was taken against.
   */
  targetUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — user the action was applied to'
  },
 
  /**
   * The type of moderation action taken.
   * For example: WARNING | SUSPENSION | MESSAGE_DELETION
   */
  moderationActionType: {
    type:      DataTypes.STRING(30),
    allowNull: false,
    comment:   'Action type — WARNING | SUSPENSION | MESSAGE_DELETION'
  },
 
  moderationActionReason: {
    type:    DataTypes.TEXT,
    comment: 'Moderator-provided reason for the action — stored for audit'
  },
 
  actionExecutionTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when the moderation action was executed'
  }
 
}, {
  tableName: 'moderationActionLog',
  comment:   'Immutable audit trail of all moderation actions on the platform'
});

module.exports = ModerationActionLog;