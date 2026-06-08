const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * AuditLog
 * --------
 * General system-level audit trail for significant platform events.
 * Complements ModerationActionLog with broader action tracking.
 * Used by system administrators for compliance and security monitoring.
 *
 * Relationships defined in models/index.js:
 *   - auditLog.belongsTo(userAccount, as: 'actor')
 */
const AuditLog = sequelize.define('auditLog', {
 
  auditId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this audit record'
  },
 
  actorUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — user who performed the audited action'
  },
 
  /**
   * Category of action — for example: LOGIN | REPORT_SUBMITTED |
   * ASSIGNMENT_CHANGED | ACCOUNT_SUSPENDED | RESOURCE_UPLOADED
   */
  actionType: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    comment:   'Action category — e.g. LOGIN, REPORT_SUBMITTED, ASSIGNMENT_CHANGED'
  },
 
  /**
   * The entity that was acted upon — for example: incidentReport | userAccount.
   * Nullable because some actions (e.g. LOGIN) have no specific target entity.
   */
  targetEntity: {
    type:    DataTypes.STRING(100),
    comment: 'Entity the action was performed on — nullable for non-targeted actions'
  },
 
  actionTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when the audited action occurred'
  }
 
}, {
  tableName: 'auditLog',
  comment:   'General platform audit trail — used for compliance and security monitoring'
});

module.exports = AuditLog;