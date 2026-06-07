/**
 * ngoAdministratorProfile.js (inline)
 * ------------------------------------
 * Profile for users with the NGO_ADMIN role.
 *
 * NGO Admins have the highest operational authority on the platform.
 * They can view all survivor data, manage staff assignments, moderate
 * community content, and access the analytics dashboard.
 *
 * Relationships defined in models/index.js:
 *   - ngoAdministratorProfile.belongsTo(userAccount)
 *   - ngoAdministratorProfile.hasMany(communityRoom)
 */
const { DataTypes } = require('sequelize');

const sequelize = require('../config/database');
const NgoAdministratorProfile = sequelize.define('ngoAdministratorProfile', {
 
  ngoAdminId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this NGO administrator profile'
  },
 
  userId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    unique:    true,
    comment:   'FK to userAccount — one NGO admin profile per user account'
  },
 
  /**
   * The department or team within the NGO this admin belongs to.
   * For example: Case Management, Community Support, Legal Aid.
   */
  administrativeDepartment: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    comment:   'NGO department — e.g. Case Management, Community Support'
  },
 
  /**
   * Numeric access level for fine-grained admin permission tiers
   * within the NGO. Higher value = broader access.
   */
  administratorAccessLevel: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    comment:   'Permission tier within NGO admin hierarchy'
  }
 
}, {
  tableName: 'ngoAdministratorProfile',
  comment:   'NGO administrator profile — extends userAccount for NGO_ADMIN role users'
});


module.exports = NgoAdministratorProfile;

