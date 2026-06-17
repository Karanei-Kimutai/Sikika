const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * UssdCallbackRequest
 * -------------------
 * Created when a user (registered or unregistered) requests a callback
 * via the USSD interface. NGO staff follow up on PENDING requests.
 *
 * No FK to userAccount — unregistered users can also request callbacks,
 * and only their phone number is captured.
 */
const UssdCallbackRequest = sequelize.define('ussdCallbackRequest', {
 
  callbackRequestId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this callback request'
  },
 
  /**
   * The phone number to call back.
   * No user account linkage — unregistered users can make requests.
   */
  requesterPhoneNumber: {
    type:      DataTypes.STRING(15),
    allowNull: false,
    comment:   'Phone number to call — no FK, unregistered users can request'
  },
 
  callbackRequestTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when the callback was requested'
  },
 
  /**
   * Fulfillment status — updated by NGO staff when the callback is made.
   */
  callbackFulfillmentStatus: {
    type:         DataTypes.ENUM('PENDING', 'COMPLETED', 'CANCELLED'),
    defaultValue: 'PENDING',
    comment:      'Callback status — updated by staff when fulfilled or cancelled'
  },

  /**
   * Auto-assigned at creation time to the least-loaded available counsellor
   * (see ussdController.pickLeastLoadedCounsellor), so NGO Admin doesn't have
   * to manually triage every incoming callback. No FK constraint — mirrors
   * this model's existing no-FK pattern, and the counsellor profile may later
   * be removed/reassigned independently of this historical record.
   */
  assignedCounsellorId: {
    type:      DataTypes.STRING(36),
    allowNull: true,
    comment:   'CounsellorProfile.counsellorId auto-assigned at creation — admin may still reassign'
  }

}, {
  tableName: 'ussdCallbackRequest',
  comment:   'Callback request from USSD — no account required, phone number only'
});

module.exports = UssdCallbackRequest;