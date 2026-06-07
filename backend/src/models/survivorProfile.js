/**
 * survivorProfile.js
 * ------------------
 * Sequelize model for the `survivorProfile` table.
 *
 * Stores survivor-specific attributes. Every user with role SURVIVOR
 * has exactly one row here. This table holds the survivor's public
 * identity (nickname) and their private identity (county, gender,
 * assigned staff) — see the Identity Separation Model in the SSD.
 *
 * Relationships defined in models/index.js:
 *   - survivorProfile.belongsTo(userAccount)
 *   - survivorProfile.belongsTo(counsellorProfile, as: 'assignedCounsellor')
 *   - survivorProfile.belongsTo(legalCounselProfile, as: 'assignedLegalCounsel')
 *   - survivorProfile.hasMany(incidentReport)
 *   - survivorProfile.hasMany(directChatChannel)
 *   - survivorProfile.hasMany(staffAssignmentHistory)
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SurvivorProfile = sequelize.define('survivorProfile', {

  survivorId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key — separate from userId to allow role profile isolation'
  },

  /**
   * Foreign key to userAccount. One-to-one: each survivor maps
   * to exactly one user account.
   */
  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one survivor profile per user account'
  },

  /**
   * The name the survivor uses in community spaces.
   * This is their PUBLIC identity — visible to all registered users
   * in community rooms. Their real name is never stored.
   */
  displayNickname: {
    type:      DataTypes.STRING(50),
    allowNull: false,
    comment:   'Public pseudonym used in community rooms — not a real name'
  },

  /**
   * Gender — part of the PRIVATE identity layer.
   * Only visible to the survivor themselves and their assigned NGO staff.
   */
  assignedGender: {
    type:    DataTypes.STRING(20),
    comment: 'Private — visible only to survivor and assigned staff'
  },

  /**
   * County of residence — used by the auto-assignment algorithm to
   * match the survivor with staff in the same geographic area.
   * Part of the PRIVATE identity layer.
   */
  residenceCounty: {
    type:      DataTypes.STRING(50),
    allowNull: false,
    comment:   'Used for location-based counsellor/legal counsel assignment'
  },

  /**
   * Foreign key to counsellorProfile — the currently assigned counsellor.
   * Set automatically by the assignment algorithm at registration.
   * Can be reassigned by NGO Admin on request. SET NULL on delete
   * so that a survivor is not deleted if their counsellor leaves.
   */
  assignedCounsellorId: {
    type:    DataTypes.STRING(36),
    comment: 'FK to counsellorProfile — set by auto-assignment at registration'
  },

  /**
   * Foreign key to legalCounselProfile — the currently assigned legal counsel.
   * Same assignment logic as assignedCounsellorId.
   */
  assignedLegalCounselId: {
    type:    DataTypes.STRING(36),
    comment: 'FK to legalCounselProfile — set by auto-assignment at registration'
  },

  /**
   * Optional JSON blob for any survivor-specific privacy preferences.
   * For example: notification opt-outs, display settings.
   * Stored as JSON to allow flexible extension without schema changes.
   */
  privacyPreferencesJson: {
    type:    DataTypes.JSON,
    comment: 'Optional JSON for survivor privacy preferences and settings'
  }

}, {
  tableName: 'survivorProfile',
  comment:   'Survivor-specific profile — extends userAccount for SURVIVOR role users'
});

module.exports = SurvivorProfile;