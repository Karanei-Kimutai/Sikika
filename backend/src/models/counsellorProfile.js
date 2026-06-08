/**
 * counsellorProfile.js
 * --------------------
 * Sequelize model for the `counsellorProfile` table.
 *
 * Stores counsellor-specific attributes. Every user with role COUNSELLOR
 * has exactly one row here. The workloadScore and availabilityStatus
 * fields are used by the auto-assignment algorithm when pairing a new
 * survivor with a counsellor.
 *
 * Relationships defined in models/index.js:
 *   - counsellorProfile.belongsTo(userAccount)
 *   - counsellorProfile.hasMany(survivorProfile, as: 'assignedSurvivors')
 *   - counsellorProfile.hasMany(staffAssignmentHistory)
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CounsellorProfile = sequelize.define('counsellorProfile', {

  counsellorId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this counsellor profile'
  },

  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one counsellor profile per user account'
  },

  /**
   * The counsellor's area of professional specialization.
   * For example: trauma counselling, domestic violence support.
   */
  professionalSpecialization: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    comment:   'Counsellor area of expertise — e.g. trauma counselling'
  },

  /**
   * Tracks the number of active survivors assigned to this counsellor.
   * The auto-assignment algorithm selects the counsellor with the
   * lowest workload score in the survivor's county.
   * Incremented on assignment, decremented on reassignment or resolution.
   */
  currentWorkloadScore: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
    comment:      'Active survivor count — used by auto-assignment to balance load'
  },

  /**
   * Current availability — controls the presence indicator shown
   * to survivors in the chat interface.
   *   AVAILABLE: online and accepting messages
   *   BUSY:      online but in a session
   *   OFFLINE:   not currently active
   */
  availabilityStatus: {
    type:      DataTypes.ENUM('AVAILABLE', 'BUSY', 'OFFLINE'),
    allowNull: false,
    comment:   'Drives presence indicator in survivor chat interface'
  }

}, {
  tableName: 'counsellorProfile',
  comment:   'Counsellor-specific profile — extends userAccount for COUNSELLOR role users'
});

module.exports = CounsellorProfile;