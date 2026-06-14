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
   * Stored on Cloudinary (private/authenticated) like evidence files.
   * Populated by POST /api/legal-cases/:legalCaseId/document after counsel drafts.
   */
  generatedDocumentPath: {
    type:    DataTypes.TEXT,
    comment: 'Cloudinary public_id of the generated PDF — restricted authenticated access'
  },

  // ── Structured case authoring fields ───────────────────────────────────────
  // These fields allow legal counsel to draft case documentation in-app.
  // A generated PDF is compiled from these fields on demand and stored privately.

  /**
   * A concise narrative summary of the case, authored by legal counsel.
   * Printed as the executive summary section of the generated PDF.
   */
  caseSummary: {
    type:    DataTypes.TEXT,
    comment: 'Narrative case summary authored by legal counsel'
  },

  /**
   * The legal grounds or statutory basis being invoked.
   * e.g. "Sexual Offences Act (2006), Section 3" or "Penal Code Cap. 63, S. 250".
   */
  legalGroundsText: {
    type:    DataTypes.TEXT,
    comment: 'Statutory or common-law grounds cited in the case'
  },

  /**
   * The specific remedy, protection order, or relief being sought.
   * e.g. "Temporary Protection Order", "Criminal prosecution referral".
   */
  requestedReliefText: {
    type:    DataTypes.TEXT,
    comment: 'Specific remedy or legal relief being sought'
  },

  /**
   * Recommended next steps for external handover.
   * e.g. "Refer to DPP", "Arrange safe-house relocation", "Medical examination".
   * The system never contacts external parties — all handover is manual.
   */
  recommendedActionsText: {
    type:    DataTypes.TEXT,
    comment: 'Recommended next steps for manual external handover — system does not contact any party directly'
  },

  /**
   * UTC timestamp of the last time legal counsel saved a draft.
   * Updated by PATCH /api/legal-cases/:legalCaseId when any authoring field changes.
   */
  draftLastUpdatedAt: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp of the most recent draft save by legal counsel'
  },

  /**
   * UTC timestamp of when the PDF document was last successfully generated.
   * Set by POST /api/legal-cases/:legalCaseId/document after Cloudinary upload.
   */
  documentGeneratedAt: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp of the most recent successful PDF generation'
  }

}, {
  tableName: 'legalCaseFile',
  comment:   'Legal case record — created on report escalation with survivor consent'
});

module.exports = LegalCaseFile;