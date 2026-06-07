/**
 * legalCounselProfile.js
 * ----------------------
 * Sequelize model for the `legalCounselProfile` table.
 *
 * Mirrors the structure of counsellorProfile but for users with
 * the LEGAL_COUNSEL role. Legal counsel provide legal guidance,
 * review incident reports, and prepare legal case documentation.
 *
 * Relationships defined in models/index.js:
 *   - legalCounselProfile.belongsTo(userAccount)
 *   - legalCounselProfile.hasMany(survivorProfile, as: 'assignedSurvivors')
 *   - legalCounselProfile.hasMany(legalCaseFile)
 *   - legalCounselProfile.hasMany(staffAssignmentHistory)
 */
 
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
 
const LegalCounselProfile = sequelize.define('legalCounselProfile', {
 
  legalCounselId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this legal counsel profile'
  },
 
  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one legal counsel profile per user account'
  },
 
  /**
   * Legal specialization area — for example: family law, criminal law,
   * human rights law. Informs which survivors are best matched to this counsel.
   */
  professionalSpecialization: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    comment:   'Legal specialization — e.g. family law, criminal law'
  },
 
  /**
   * Tracks the number of active survivors assigned to this legal counsel.
   * Used by the auto-assignment algorithm identically to the counsellor equivalent.
   */
  currentWorkloadScore: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
    comment:      'Active survivor count — used by auto-assignment to balance load'
  },
 
  /**
   * Availability status — same semantics as counsellorProfile.availabilityStatus.
   */
  availabilityStatus: {
    type:      DataTypes.ENUM('AVAILABLE', 'BUSY', 'OFFLINE'),
    allowNull: false,
    comment:   'Drives presence indicator in survivor chat interface'
  }
 
}, {
  tableName: 'legalCounselProfile',
  comment:   'Legal counsel profile — extends userAccount for LEGAL_COUNSEL role users'
});
 
module.exports = LegalCounselProfile;