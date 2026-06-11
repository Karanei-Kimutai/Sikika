const { DataTypes } = require('sequelize');
const { randomUUID } = require('crypto');
const sequelize = require('../config/database');

const StaffReassignmentRequest = sequelize.define('staffReassignmentRequest', {
  requestId: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    allowNull: false,
    defaultValue: () => randomUUID()
  },

  survivorId: {
    type: DataTypes.STRING(36),
    allowNull: false
  },

  requestedScope: {
    type: DataTypes.ENUM('COUNSELLOR', 'LEGAL_COUNSEL', 'BOTH'),
    allowNull: false,
    defaultValue: 'BOTH'
  },

  requestReasonText: {
    type: DataTypes.TEXT,
    allowNull: false
  },

  requestStatus: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },

  ngoAdminReviewerUserId: {
    type: DataTypes.STRING(36),
    allowNull: true
  },

  ngoAdminReviewNote: {
    type: DataTypes.TEXT,
    allowNull: true
  },

  reviewTimestamp: {
    type: DataTypes.DATE,
    allowNull: true
  },

  requestTimestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'staffReassignmentRequest'
});

module.exports = StaffReassignmentRequest;
