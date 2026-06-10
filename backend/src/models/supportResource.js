const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * SupportResource
 * ---------------
 * Categorised support content uploaded by counsellors, legal counsel,
 * or NGO Admins. Accessible to all registered users and unregistered visitors.
 *
 * Relationships defined in models/index.js:
 *   - supportResource.belongsTo(userAccount, as: 'uploadedBy')
 */
const SupportResource = sequelize.define('supportResource', {
 
  resourceId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this resource'
  },
 
  resourceTitle: {
    type:      DataTypes.STRING(255),
    allowNull: false,
    comment:   'Display title of the resource'
  },
 
  resourceDescription: {
    type:    DataTypes.TEXT,
    comment: 'Optional description of the resource content and purpose'
  },
 
  /**
   * Category from the defined resource taxonomy — see SSD §21.2.
   * For example: emergency_hotlines | shelters | legal_guidance | counselling
   */
  resourceCategory: {
    type:      DataTypes.STRING(50),
    allowNull: false,
    comment:   'Resource category — drives filtering and search (see SSD §21.2)'
  },
 
  /**
   * URL to the resource file or external link.
   * For uploaded files, this is a Cloudinary URL (signed where sensitive).
   */
  resourceFileUrl: {
    type:      DataTypes.TEXT,
    allowNull: false,
    comment:   'URL to the resource — Cloudinary URL for uploaded files'
  },

  cloudinaryPublicId: {
    type:    DataTypes.STRING(255),
    comment: 'Cloudinary public identifier for this uploaded resource'
  },

  cloudinaryResourceType: {
    type:    DataTypes.STRING(20),
    comment: 'Cloudinary resource type (image, video, raw) for deletion operations'
  },

  originalFileName: {
    type:    DataTypes.STRING(255),
    comment: 'Original uploaded file name supplied by uploader'
  },

  mimeType: {
    type:    DataTypes.STRING(120),
    comment: 'MIME type detected by upload middleware'
  },

  fileSizeBytes: {
    type:    DataTypes.INTEGER.UNSIGNED,
    comment: 'File size in bytes of the uploaded resource'
  },
 
  /**
   * The staff member or admin who uploaded this resource.
   * References userAccount so that counsellors, legal counsel,
   * and NGO Admins can all be tracked as uploaders.
   */
  uploadedByStaffId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — staff member who uploaded this resource'
  },
 
  resourceUploadTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this resource was uploaded'
  }
 
}, {
  tableName: 'supportResource',
  comment:   'Support resource — uploaded by staff, accessible to all users'
});

module.exports = SupportResource;
