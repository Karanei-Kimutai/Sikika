const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * DirectChatChannel
 * -----------------
 * Represents a private, end-to-end encrypted chat channel between
 * one survivor and one assigned staff member (counsellor or legal counsel).
 *
 * Each survivor has two channels: one with their assigned counsellor
 * and one with their assigned legal counsel. These channels are separate
 * and not visible to each other.
 *
 * Relationships defined in models/index.js:
 *   - directChatChannel.belongsTo(survivorProfile)
 *   - directChatChannel.belongsTo(userAccount, as: 'supportStaff')
 *   - directChatChannel.hasMany(directChatMessage)
 */
const DirectChatChannel = sequelize.define('directChatChannel', {
 
  chatId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this chat channel'
  },
 
  survivorId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to survivorProfile — the survivor in this channel'
  },
 
  /**
   * The staff member on the other end of the channel.
   * References userAccount directly rather than counsellorProfile/legalCounselProfile
   * so that a single FK covers both staff types.
   */
  supportStaffCounterpartId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — the staff counterpart (counsellor or legal counsel)'
  },
 
  /**
   * Identifies whether this is a counsellor channel or legal counsel channel.
   * Stored as a string rather than ENUM to allow future channel types.
   */
  chatChannelType: {
    type:      DataTypes.STRING(40),
    allowNull: false,
    comment:   'Channel type — counsellor_channel | legal_counsel_channel'
  },
 
  /**
   * Chat lifecycle status.
   * ARCHIVED: hidden from default view but accessible on request.
   * DELETED: soft-deleted — data preserved for audit but not shown.
   */
  chatChannelStatus: {
    type:      DataTypes.STRING(20),
    allowNull: false,
    comment:   'Channel status — active | archived | deleted'
  },
 
  chatCreationTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp when this channel was first created'
  }
 
}, {
  tableName: 'directChatChannel',
  comment:   'Private E2EE chat channel — one survivor to one staff member'
});

module.exports = DirectChatChannel;