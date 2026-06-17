/**
 * models/index.js
 * ---------------
 * Central registry for all Sequelize models.
 *
 * This file imports every model, defines all associations between them,
 * and exports the complete set. It is the single entry point for database
 * model access throughout the application.
 *
 * Import pattern in route/service files:
 *   const { UserAccount, SurvivorProfile, IncidentReport } = require('../models');
 *
 * Association rules followed:
 *   - hasOne / hasMany: defined on the table that OWNS the foreign key's parent
 *   - belongsTo: defined on the table that HOLDS the foreign key
 *   - foreignKey option: must match the column name in the SQL schema exactly
 */

const sequelize = require('../config/database');

// ── Identity models ─────────────────────────────────────────────────────────
const UserAccount               = require('./userAccount');
const SurvivorProfile           = require('./survivorProfile');
const CounsellorProfile         = require('./counsellorProfile');
const LegalCounselProfile       = require('./legalCounselProfile');
const NgoAdministratorProfile   = require('./ngoAdministratorProfile');
const ModeratorProfile          = require('./moderatorProfile');

// ── Reporting models ─────────────────────────────────────────────────────────
const IncidentReport            = require('./incidentReport');
const EvidenceFile              = require('./evidenceFile');

// ── Communication models ─────────────────────────────────────────────────────
const LegalCaseFile             = require('./legalCaseFile');
const DirectChatChannel         = require('./directChatChannel');
const DirectChatMessage         = require('./directChatMessage');
const CommunityRoom             = require('./communityRoom');
const RoomMembership            = require('./roomMembership');
const CommunityMessage          = require('./communityMessage');

// ── Support models ───────────────────────────────────────────────────────────
const HarmfulContentReport      = require('./harmfulContentReport');
const ModerationActionLog       = require('./moderationActionLog');
const AuditLog                  = require('./auditlog');
const InAppNotification         = require('./inAppNotification');
const SupportResource           = require('./supportResource');
const ResourceAccessEvent       = require('./resourceAccessEvent');
const StaffAssignmentHistory    = require('./staffAssignmentHistory');
const StaffReassignmentRequest  = require('./staffReassignmentRequest');
const UssdCallbackRequest       = require('./ussdCallbackRequest');
const OtpVerificationRequest    = require('./otpVerificationRequest');
const SystemSetting             = require('./systemSetting');


// ════════════════════════════════════════════════════════════════════════════
// ASSOCIATIONS
// ════════════════════════════════════════════════════════════════════════════

// ── UserAccount → profile tables (1:1) ──────────────────────────────────────

/**
 * Each user account has at most one role-specific profile.
 * The profile table holds the FK (userId).
 */
UserAccount.hasOne(SurvivorProfile,            { foreignKey: 'userId', onDelete: 'CASCADE' });
SurvivorProfile.belongsTo(UserAccount,         { foreignKey: 'userId' });

UserAccount.hasOne(CounsellorProfile,          { foreignKey: 'userId', onDelete: 'CASCADE' });
CounsellorProfile.belongsTo(UserAccount,       { foreignKey: 'userId' });

UserAccount.hasOne(LegalCounselProfile,        { foreignKey: 'userId', onDelete: 'CASCADE' });
LegalCounselProfile.belongsTo(UserAccount,     { foreignKey: 'userId' });

UserAccount.hasOne(NgoAdministratorProfile,    { foreignKey: 'userId', onDelete: 'CASCADE' });
NgoAdministratorProfile.belongsTo(UserAccount, { foreignKey: 'userId' });

UserAccount.hasOne(ModeratorProfile,    { foreignKey: 'userId', onDelete: 'CASCADE' });
ModeratorProfile.belongsTo(UserAccount, { foreignKey: 'userId' });


// ── SurvivorProfile → assigned staff (M:1 from survivor side) ───────────────

/**
 * Each survivor is assigned to one counsellor and one legal counsel.
 * The FK lives in survivorProfile (assignedCounsellorId, assignedLegalCounselId).
 * 'as' aliases are required because survivorProfile has two FKs to counsellor/legal tables.
 */
SurvivorProfile.belongsTo(CounsellorProfile, {
  foreignKey: 'assignedCounsellorId',
  as:         'assignedCounsellor',
  onDelete:   'SET NULL'
});
CounsellorProfile.hasMany(SurvivorProfile, {
  foreignKey: 'assignedCounsellorId',
  as:         'assignedSurvivors'
});

SurvivorProfile.belongsTo(LegalCounselProfile, {
  foreignKey: 'assignedLegalCounselId',
  as:         'assignedLegalCounsel',
  onDelete:   'SET NULL'
});
LegalCounselProfile.hasMany(SurvivorProfile, {
  foreignKey: 'assignedLegalCounselId',
  as:         'assignedSurvivors'
});


// ── IncidentReport ────────────────────────────────────────────────────────────

/**
 * Each survivor can have many incident reports.
 * The FK survivorId lives in incidentReport.
 */
SurvivorProfile.hasMany(IncidentReport,  { foreignKey: 'survivorId', onDelete: 'CASCADE' });
IncidentReport.belongsTo(SurvivorProfile, { foreignKey: 'survivorId' });

/**
 * Each report can have many evidence files.
 */
IncidentReport.hasMany(EvidenceFile,  { foreignKey: 'reportId', onDelete: 'CASCADE' });
EvidenceFile.belongsTo(IncidentReport, { foreignKey: 'reportId' });

/**
 * Each report can have at most one legal case (enforced by UNIQUE on reportId).
 */
IncidentReport.hasOne(LegalCaseFile,  { foreignKey: 'reportId', onDelete: 'CASCADE' });
LegalCaseFile.belongsTo(IncidentReport, { foreignKey: 'reportId' });


// ── DirectChatChannel ─────────────────────────────────────────────────────────

/**
 * Each survivor can have multiple chat channels (one per staff member).
 */
SurvivorProfile.hasMany(DirectChatChannel, { foreignKey: 'survivorId', onDelete: 'CASCADE' });
DirectChatChannel.belongsTo(SurvivorProfile, { foreignKey: 'survivorId' });

/**
 * The staff counterpart is referenced via userAccount to cover both
 * counsellor and legal counsel without two separate FKs.
 */
UserAccount.hasMany(DirectChatChannel, { foreignKey: 'supportStaffCounterpartId', as: 'staffChannels' });
DirectChatChannel.belongsTo(UserAccount, { foreignKey: 'supportStaffCounterpartId', as: 'supportStaff' });

/**
 * Each channel contains many messages.
 */
DirectChatChannel.hasMany(DirectChatMessage, { foreignKey: 'chatId', onDelete: 'CASCADE' });
DirectChatMessage.belongsTo(DirectChatChannel, { foreignKey: 'chatId' });

/**
 * Message sender — references userAccount (could be survivor or staff).
 */
UserAccount.hasMany(DirectChatMessage, { foreignKey: 'senderUserId', as: 'sentMessages' });
DirectChatMessage.belongsTo(UserAccount, { foreignKey: 'senderUserId', as: 'sender' });


// ── CommunityRoom ─────────────────────────────────────────────────────────────

/**
 * NGO Admin creates community rooms.
 * SET NULL on delete so rooms survive if the admin account is removed.
 */
NgoAdministratorProfile.hasMany(CommunityRoom, { foreignKey: 'createdByAdminId', onDelete: 'SET NULL' });
CommunityRoom.belongsTo(NgoAdministratorProfile, { foreignKey: 'createdByAdminId', as: 'createdByAdmin' });

/**
 * Rooms have many members (via junction table) and many messages.
 */
CommunityRoom.hasMany(RoomMembership,   { foreignKey: 'roomId', onDelete: 'CASCADE' });
RoomMembership.belongsTo(CommunityRoom, { foreignKey: 'roomId' });

UserAccount.hasMany(RoomMembership,     { foreignKey: 'userId', onDelete: 'CASCADE' });
RoomMembership.belongsTo(UserAccount,   { foreignKey: 'userId' });

CommunityRoom.hasMany(CommunityMessage,    { foreignKey: 'roomId', onDelete: 'CASCADE' });
CommunityMessage.belongsTo(CommunityRoom,  { foreignKey: 'roomId' });

UserAccount.hasMany(CommunityMessage,      { foreignKey: 'senderUserId', as: 'communityMessages' });
CommunityMessage.belongsTo(UserAccount,    { foreignKey: 'senderUserId', as: 'sender' });


// ── HarmfulContentReport ──────────────────────────────────────────────────────

CommunityMessage.hasMany(HarmfulContentReport,    { foreignKey: 'reportedCommunityMessageId', onDelete: 'CASCADE' });
HarmfulContentReport.belongsTo(CommunityMessage,  { foreignKey: 'reportedCommunityMessageId', as: 'reportedMessage' });

UserAccount.hasMany(HarmfulContentReport,    { foreignKey: 'reporterUserId', as: 'flaggedContent' });
HarmfulContentReport.belongsTo(UserAccount,  { foreignKey: 'reporterUserId', as: 'reporter' });


// ── ModerationActionLog ───────────────────────────────────────────────────────

/**
 * Two separate FK relationships to userAccount — moderator and target.
 * 'as' aliases are required to distinguish them.
 */
UserAccount.hasMany(ModerationActionLog, { foreignKey: 'moderatorUserId', as: 'moderationActions' });
ModerationActionLog.belongsTo(UserAccount, { foreignKey: 'moderatorUserId', as: 'moderator' });

UserAccount.hasMany(ModerationActionLog, { foreignKey: 'targetUserId', as: 'receivedModerationActions' });
ModerationActionLog.belongsTo(UserAccount, { foreignKey: 'targetUserId', as: 'targetUser' });


// ── AuditLog ──────────────────────────────────────────────────────────────────

UserAccount.hasMany(AuditLog,    { foreignKey: 'actorUserId', as: 'auditActions' });
AuditLog.belongsTo(UserAccount,  { foreignKey: 'actorUserId', as: 'actor' });


// ── InAppNotification ─────────────────────────────────────────────────────────

UserAccount.hasMany(InAppNotification,    { foreignKey: 'recipientUserId', as: 'notifications' });
InAppNotification.belongsTo(UserAccount,  { foreignKey: 'recipientUserId', as: 'recipient' });


// ── SupportResource ───────────────────────────────────────────────────────────

UserAccount.hasMany(SupportResource,    { foreignKey: 'uploadedByStaffId', as: 'uploadedResources' });
SupportResource.belongsTo(UserAccount,  { foreignKey: 'uploadedByStaffId', as: 'uploadedBy' });

SupportResource.hasMany(ResourceAccessEvent, { foreignKey: 'resourceId', onDelete: 'CASCADE' });
ResourceAccessEvent.belongsTo(SupportResource, { foreignKey: 'resourceId' });

UserAccount.hasMany(ResourceAccessEvent, { foreignKey: 'accessorUserId', onDelete: 'SET NULL' });
ResourceAccessEvent.belongsTo(UserAccount, { foreignKey: 'accessorUserId' });


// ── StaffAssignmentHistory ────────────────────────────────────────────────────

SurvivorProfile.hasMany(StaffAssignmentHistory,    { foreignKey: 'survivorId', onDelete: 'CASCADE' });
StaffAssignmentHistory.belongsTo(SurvivorProfile,  { foreignKey: 'survivorId' });

CounsellorProfile.hasMany(StaffAssignmentHistory,    { foreignKey: 'counsellorId', onDelete: 'SET NULL' });
StaffAssignmentHistory.belongsTo(CounsellorProfile,  { foreignKey: 'counsellorId' });

LegalCounselProfile.hasMany(StaffAssignmentHistory,    { foreignKey: 'legalCounselId', onDelete: 'SET NULL' });
StaffAssignmentHistory.belongsTo(LegalCounselProfile,  { foreignKey: 'legalCounselId' });

// ── StaffReassignmentRequest ───────────────────────────────────────────────

SurvivorProfile.hasMany(StaffReassignmentRequest, {
  foreignKey: 'survivorId',
  onDelete: 'CASCADE'
});
StaffReassignmentRequest.belongsTo(SurvivorProfile, {
  foreignKey: 'survivorId'
});

UserAccount.hasMany(StaffReassignmentRequest, {
  foreignKey: 'ngoAdminReviewerUserId',
  as: 'reviewedReassignmentRequests'
});
StaffReassignmentRequest.belongsTo(UserAccount, {
  foreignKey: 'ngoAdminReviewerUserId',
  as: 'reviewedByNgoAdmin'
});


// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  sequelize,

  // Identity
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  ModeratorProfile,

  // Reporting
  IncidentReport,
  EvidenceFile,
  LegalCaseFile,

  // Communication
  DirectChatChannel,
  DirectChatMessage,
  CommunityRoom,
  RoomMembership,
  CommunityMessage,

  // Moderation
  HarmfulContentReport,
  ModerationActionLog,
  AuditLog,

  // Notifications
  InAppNotification,

  // Resources
  SupportResource,
  ResourceAccessEvent,

  // Assignments and external services
  StaffAssignmentHistory,
  StaffReassignmentRequest,
  UssdCallbackRequest,
  OtpVerificationRequest,

  // Platform settings
  SystemSetting
};