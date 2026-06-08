const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * RoomMembership
 * --------------
 * Junction table tracking which users have joined which community rooms.
 * A user can join many rooms; a room can have many users.
 *
 * Relationships defined in models/index.js:
 *   - roomMembership.belongsTo(communityRoom)
 *   - roomMembership.belongsTo(userAccount)
 */
const RoomMembership = sequelize.define('roomMembership', {
 
  membershipId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this membership record'
  },
 
  roomId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to communityRoom — the room being joined'
  },
 
  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — the user who joined the room'
  },
 
  joinTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when the user joined this room'
  }
 
}, {
  tableName: 'roomMembership',
  comment:   'Junction table — tracks which users have joined which community rooms'
});

module.exports = RoomMembership;