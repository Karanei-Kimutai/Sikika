/**
 * systemAdministratorProfile.js (inline)
 * ----------------------------------------
 * Profile for users with the SYSTEM_ADMIN role.
 *
 * System administrators manage platform infrastructure only.
 * They have ZERO access to survivor data, reports, messages,
 * or evidence — this is a hard architectural constraint (see SSD §11).
 *
 * Relationships defined in models/index.js:
 *   - systemAdministratorProfile.belongsTo(userAccount)
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SystemAdministratorProfile = sequelize.define('systemAdministratorProfile', {
 
  systemAdminId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this system administrator profile'
  },
 
  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one system admin profile per user account'
  },
 
  /**
   * Comma-separated list of maintenance permissions granted.
   * For example: 'server_restart,log_access,backup_management'.
   */
  maintenancePrivileges: {
    type:      DataTypes.STRING(255),
    allowNull: false,
    comment:   'Infrastructure maintenance permissions — no access to survivor data'
  },
 
  /**
   * Numeric system access level — controls which infrastructure
   * components this admin can interact with.
   */
  systemAccessLevel: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    comment:   'Infrastructure access tier — unrelated to survivor data permissions'
  }
 
}, {
  tableName: 'systemAdministratorProfile',
  comment:   'System admin profile — infrastructure only, zero survivor data access'
});
 
module.exports = SystemAdministratorProfile;
