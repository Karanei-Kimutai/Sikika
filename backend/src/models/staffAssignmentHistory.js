const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * StaffAssignmentHistory
 * ----------------------
 * Tracks the history of counsellor and legal counsel assignments for each survivor.
 * A new record is created whenever an assignment is made or changed.
 * The current assignment is the record with a NULL assignmentEndTimestamp.
 *
 * Relationships defined in models/index.js:
 *   - staffAssignmentHistory.belongsTo(survivorProfile)
 *   - staffAssignmentHistory.belongsTo(counsellorProfile)
 *   - staffAssignmentHistory.belongsTo(legalCounselProfile)
 */
const StaffAssignmentHistory = sequelize.define('staffAssignmentHistory', {
 
  assignmentHistoryId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this assignment history record'
  },
 
  survivorId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to survivorProfile — the survivor this assignment concerns'
  },
 
  /**
   * The counsellor in this assignment period.
   * NULL if no counsellor was assigned during this period.
   */
  counsellorId: {
    type:    DataTypes.STRING(36),
    comment: 'FK to counsellorProfile — NULL if no counsellor in this period'
  },
 
  /**
   * The legal counsel in this assignment period.
   * NULL if no legal counsel was assigned during this period.
   */
  legalCounselId: {
    type:    DataTypes.STRING(36),
    comment: 'FK to legalCounselProfile — NULL if no legal counsel in this period'
  },
 
  assignmentStartTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp when this assignment became active'
  },
 
  /**
   * When this assignment ended. NULL means this is the current assignment.
   * Set when the survivor is reassigned to a different staff member.
   */
  assignmentEndTimestamp: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp when this assignment ended — NULL = currently active'
  },
 
  /**
   * Why the assignment was created or changed.
   * For example: 'Initial auto-assignment' | 'Survivor requested reassignment'
   */
  assignmentReason: {
    type:    DataTypes.STRING(255),
    comment: 'Reason for this assignment — e.g. initial auto-assignment, reassignment'
  }
 
}, {
  tableName: 'staffAssignmentHistory',
  comment:   'Assignment audit trail — records all historical and current survivor-staff pairings'
});

module.exports = StaffAssignmentHistory;