const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * LegalCaseFile
 * -------------
 * Represents a formal legal case created when an incident report is
 * escalated by a legal counsel with survivor consent.
 * Each incident report can have at most one associated legal case (1:0..1).
 *
 * Relationships defined in models/index.js:
 *   - legalCaseFile.belongsTo(incidentReport)
 */
const LegalCaseFile = sequelize.define('legalCaseFile', {
 
  legalCaseId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this legal case'
  },
 
  /**
   * The incident report this case was escalated from.
   * UNIQUE constraint enforces the 1:0..1 relationship — one report
   * can only be escalated to one legal case.
   */
  reportId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to incidentReport — one report maps to at most one legal case'
  },
 
  escalationTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp when the report was escalated to a legal case'
  },
 
  /**
   * Legal case lifecycle status. READY_FOR_SUBMISSION and SUBMITTED
   * indicate that documentation has been prepared for external handover.
   * The system never contacts law enforcement directly — this is manual.
   */
  currentCaseStatus: {
    type:      DataTypes.ENUM('OPEN', 'UNDER_INVESTIGATION', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'CLOSED'),
    allowNull: false,
    comment:   'Legal case lifecycle stage'
  },
 
  /**
   * Path or URL reference to the generated legal documentation.
   * Stored on Cloudinary like evidence files — access is restricted.
   */
  generatedDocumentPath: {
    type:    DataTypes.TEXT,
    comment: 'Reference to generated legal case document — restricted access'
  }
 
}, {
  tableName: 'legalCaseFile',
  comment:   'Legal case record — created on report escalation with survivor consent'
});

module.exports = LegalCaseFile;