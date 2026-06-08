const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * HarmfulContentReport
 * --------------------
 * Created when a user flags a community message as harmful.
 * Triggers a moderation review by counsellors, legal counsel, or NGO Admin.
 *
 * Relationships defined in models/index.js:
 *   - harmfulContentReport.belongsTo(communityMessage)
 *   - harmfulContentReport.belongsTo(userAccount, as: 'reporter')
 */
const HarmfulContentReport = sequelize.define('harmfulContentReport', {
 
  contentReportId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this content report'
  },
 
  reportedCommunityMessageId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to communityMessage — the flagged message'
  },
 
  reporterUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — the user who flagged the message'
  },
 
  reportReasonText: {
    type:      DataTypes.TEXT,
    allowNull: false,
    comment:   'Reason provided by the reporter for flagging the content'
  },
 
  reportSubmissionTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when the flag was submitted'
  },
 
  /**
   * Moderation review outcome:
   *   PENDING:  awaiting moderator review
   *   APPROVED: flag upheld — action was taken
   *   REJECTED: flag dismissed — no action required
   */
  moderationReviewStatus: {
    type:         DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
    defaultValue: 'PENDING',
    comment:      'Review status — PENDING until a moderator acts on the flag'
  }
 
}, {
  tableName: 'harmfulContentReport',
  comment:   'Content flag submitted by a user — triggers moderation review'
});

module.exports = HarmfulContentReport;