/**
 * evidenceFile.js (inline)
 * -------------------------
 * Sequelize model for the `evidenceFile` table.
 *
 * Stores metadata for evidence files uploaded alongside an incident report.
 * The actual file content is stored in Cloudinary — this table stores only
 * the reference identifiers and access metadata, never the raw file bytes.
 *
 * Relationships defined in models/index.js:
 *   - evidenceFile.belongsTo(incidentReport)
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EvidenceFile = sequelize.define('evidenceFile', {
 
  evidenceFileId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this evidence file record'
  },
 
  /**
   * The report this file belongs to.
   * CASCADE: if the report is deleted, its evidence files are too.
   */
  reportId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to incidentReport — evidence belongs to exactly one report'
  },
 
  /**
   * Type of evidence — determines how it is rendered in the UI.
   */
  evidenceFileType: {
    type:      DataTypes.STRING(20),
    allowNull: false,
    comment:   'File type — image | pdf | audio'
  },
 
  /**
   * Original file name as uploaded by the survivor.
   * Stored for display purposes only; the actual storage uses
   * the cloudinaryPublicIdentifier (a UUID, not this name).
   */
  originalFileName: {
    type:    DataTypes.STRING(255),
    comment: 'Original filename from survivor device — display only'
  },
 
  fileSize: {
    type:    DataTypes.BIGINT,
    comment: 'File size in bytes — used for storage quota tracking'
  },
 
  mimeType: {
    type:    DataTypes.STRING(100),
    comment: 'MIME type — e.g. image/jpeg, application/pdf, audio/mpeg'
  },
 
  /**
   * Cloudinary's public identifier for this file — a UUID-based string
   * assigned at upload time. Used to construct the resource URL and
   * to generate signed (time-limited) access URLs.
   * No identifying information is included in this identifier.
   */
  cloudinaryPublicIdentifier: {
    type:      DataTypes.STRING(255),
    allowNull: false,
    unique:    true,
    comment:   'Cloudinary UUID reference — used to generate signed access URLs'
  },
 
  /**
   * The most recently generated signed URL for this file.
   * Signed URLs expire after a short window — never expose raw Cloudinary URLs.
   * The application regenerates this on every authorised access request.
   */
  dynamicallySignedUrl: {
    type:      DataTypes.TEXT,
    allowNull: false,
    comment:   'Last generated signed URL — regenerated on every authorised access'
  },
 
  fileUploadTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this file was uploaded'
  }
 
}, {
  tableName: 'evidenceFile',
  comment:   'Evidence file metadata — actual files stored in Cloudinary'
});
 
module.exports = EvidenceFile;