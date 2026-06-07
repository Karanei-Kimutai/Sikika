const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * OtpVerificationRequest
 * ----------------------
 * Stores OTP verification attempts. Each OTP is hashed before storage
 * and expires after a short window. Expired and verified OTPs are kept
 * for audit trail purposes.
 *
 * No FK to userAccount — OTPs are issued before an account exists (registration).
 */
const OtpVerificationRequest = sequelize.define('otpVerificationRequest', {
 
  otpRequestId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this OTP request'
  },
 
  /**
   * The phone number the OTP was sent to via Africa's Talking API.
   * No FK — OTPs are requested during registration before an account exists.
   */
  targetPhoneNumber: {
    type:      DataTypes.STRING(15),
    allowNull: false,
    comment:   'Phone number OTP was sent to — no FK, issued pre-registration'
  },
 
  /**
   * Bcrypt hash of the OTP code. The plaintext OTP is never stored.
   * Verification compares the submitted code against this hash.
   */
  hashedOtpCode: {
    type:      DataTypes.STRING(255),
    allowNull: false,
    comment:   'Bcrypt hash of the OTP — plaintext OTP is never stored'
  },
 
  /**
   * When this OTP expires. Any verification attempt after this timestamp
   * must be rejected regardless of whether the code is correct.
   */
  otpExpirationTimestamp: {
    type:      DataTypes.DATE,
    allowNull: false,
    comment:   'Expiry time — verification rejected after this timestamp'
  },
 
  /**
   * Verification lifecycle:
   *   PENDING:  OTP sent, awaiting user submission
   *   VERIFIED: User submitted correct code before expiry
   *   EXPIRED:  Expiry passed without successful verification
   */
  otpVerificationStatus: {
    type:         DataTypes.ENUM('PENDING', 'VERIFIED', 'EXPIRED'),
    defaultValue: 'PENDING',
    comment:      'OTP lifecycle status — PENDING → VERIFIED or EXPIRED'
  }
 
}, {
  tableName: 'otpVerificationRequest',
  comment:   'OTP verification record — hashed code, expiry tracked, plaintext never stored'
});

module.exports = OtpVerificationRequest;