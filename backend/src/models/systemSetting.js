/**
 * systemSetting.js
 * ----------------
 * Key/value store for durable platform-level settings that must survive
 * process restarts.
 *
 * Currently used to persist maintenance mode state so that enabling
 * maintenance mode on one deploy continues to block traffic even if the
 * process restarts before an operator disables it.
 *
 * Schema design:
 *  - `settingKey`   STRING PK  — well-known string identifier (e.g. 'maintenance').
 *  - `settingValue` TEXT JSON  — JSON-serialised value; callers must parse on read.
 *  - Sequelize `timestamps: true` adds `createdAt` / `updatedAt` automatically.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SystemSetting = sequelize.define('SystemSetting', {
  /**
   * Human-readable key. Used as the primary key so upsert patterns are
   * straightforward without needing a surrogate id.
   */
  settingKey: {
    type: DataTypes.STRING(64),
    primaryKey: true,
    allowNull: false,
    comment: 'Well-known identifier for the setting (e.g. "maintenance").'
  },

  /**
   * JSON-serialised value. Callers must `JSON.parse` on read.
   * TEXT allows arbitrarily long JSON without hitting VARCHAR(255) limits.
   */
  settingValue: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-serialised setting payload. Parse before use.'
  }
}, {
  tableName: 'systemSetting',
  timestamps: true
});

module.exports = SystemSetting;
