const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * CommunityRoom
 * -------------
 * A group discussion space created and managed by an NGO Admin.
 * All participants post under their nickname (pseudonymous).
 * Community messages are NOT end-to-end encrypted — moderators can read them.
 *
 * Relationships defined in models/index.js:
 *   - communityRoom.belongsTo(ngoAdministratorProfile, as: 'createdByAdmin')
 *   - communityRoom.hasMany(roomMembership)
 *   - communityRoom.hasMany(communityMessage)
 */
const CommunityRoom = sequelize.define('communityRoom', {
 
  roomId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this community room'
  },
 
  roomName: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    comment:   'Display name of the community room — shown to all participants'
  },
 
  roomDescriptionText: {
    type:    DataTypes.TEXT,
    comment: 'Optional description of the room purpose and topic'
  },
 
  /**
   * The NGO Admin who created this room.
   * SET NULL on delete so that rooms survive if their creating admin leaves.
   */
  createdByAdminId: {
    type:    DataTypes.STRING(36),
    comment: 'FK to ngoAdministratorProfile — SET NULL if admin account is removed'
  },
 
  roomCreationTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this room was created'
  }
 
}, {
  tableName: 'communityRoom',
  comment:   'Community group room — created by NGO Admin, open to all registered users'
});
 
module.exports = CommunityRoom;