const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * CommunityMessage
 * ----------------
 * A message posted in a community room. NOT end-to-end encrypted,
 * as moderators must be able to read content for safety enforcement.
 * The senderUserId resolves to a nickname in the display layer —
 * the real identity is never shown in the community UI.
 *
 * Relationships defined in models/index.js:
 *   - communityMessage.belongsTo(communityRoom)
 *   - communityMessage.belongsTo(userAccount, as: 'sender')
 *   - communityMessage.hasMany(harmfulContentReport)
 */
const CommunityMessage = sequelize.define('communityMessage', {
 
  communityMessageId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this community message'
  },
 
  roomId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to communityRoom — the room this message was posted in'
  },
 
  /**
   * The user who sent the message. In the community UI, this resolves
   * to their displayNickname — the userId is never exposed to other users.
   */
  senderUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — resolves to nickname in community UI'
  },
 
  /**
   * Plaintext message content — visible to all room participants and moderators.
   * Unlike direct chat messages, this is not encrypted.
   */
  publicMessageContent: {
    type:      DataTypes.TEXT,
    allowNull: false,
    comment:   'Plaintext community message — visible to moderators for safety'
  },
 
  messageDispatchTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this message was posted'
  }
 
}, {
  tableName: 'communityMessage',
  comment:   'Community room message — plaintext, moderated, sender shown as nickname only'
});

module.exports = CommunityMessage;