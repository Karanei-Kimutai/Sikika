/**
 * seeders/index.js
 * ----------------
 * Database seeder — populates the database with realistic test data
 * for development and testing purposes.
 *
 * This seeder creates:
 *   - 2 system administrators
 *   - 2 NGO administrators
 *   - 3 counsellors
 *   - 3 legal counsel
 *   - 5 survivors (each auto-assigned to a counsellor and legal counsel)
 *   - Incident reports (some with evidence, one escalated to legal case)
 *   - Community rooms, memberships, and messages
 *   - Direct chat channels and messages
 *   - Notifications, resources, moderation logs
 *   - OTP requests and USSD callback requests
 *
 * Usage:
 *   node src/seeders/index.js
 *
 * WARNING: This script uses { force: true } on sync — it DROPS and recreates
 * all tables before seeding. Only run in development.
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt         = require('bcrypt');
const {
  sequelize,
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  SystemAdministratorProfile,
  IncidentReport,
  EvidenceFile,
  LegalCaseFile,
  DirectChatChannel,
  DirectChatMessage,
  CommunityRoom,
  RoomMembership,
  CommunityMessage,
  HarmfulContentReport,
  ModerationActionLog,
  AuditLog,
  InAppNotification,
  SupportResource,
  StaffAssignmentHistory,
  UssdCallbackRequest,
  OtpVerificationRequest
} = require('../models');

// ── Helper: hash a password ────────────────────────────────────────────────
/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 * In production, all passwords pass through this function before storage.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hash(plaintext) {
  return bcrypt.hash(plaintext, 12);
}

// ── Helper: generate a UUID ────────────────────────────────────────────────
const id = () => uuidv4();

function daysAgo(days) {
  const date = new Date();
  date.setHours(10, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}


// ════════════════════════════════════════════════════════════════════════════
// SEED FUNCTION
// ════════════════════════════════════════════════════════════════════════════

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    // Drop and recreate all tables — development only.
    await sequelize.sync({ force: true });
    console.log('✅ Tables reset and recreated.');


    // ── 1. SYSTEM ADMINISTRATORS ─────────────────────────────────────────

    console.log('🌱 Seeding system administrators...');

    const sysAdminUserId1 = id();
    await UserAccount.create({
      userId:                   sysAdminUserId1,
      phoneNumber:              '+254700000001',
      hashedPassword:           await hash('SysAdmin@2026!'),
      userRole:                 'SYSTEM_ADMIN',
      accountStatus:            'ACTIVE',
      isOtpVerified:            true
    });
    await SystemAdministratorProfile.create({
      systemAdminId:       id(),
      userId:              sysAdminUserId1,
      maintenancePrivileges: 'server_restart,log_access,backup_management',
      systemAccessLevel:   3
    });

    const sysAdminUserId2 = id();
    await UserAccount.create({
      userId:                   sysAdminUserId2,
      phoneNumber:              '+254700000002',
      hashedPassword:           await hash('SysAdmin2@2026!'),
      userRole:                 'SYSTEM_ADMIN',
      accountStatus:            'ACTIVE',
      isOtpVerified:            true
    });
    await SystemAdministratorProfile.create({
      systemAdminId:       id(),
      userId:              sysAdminUserId2,
      maintenancePrivileges: 'log_access,backup_management',
      systemAccessLevel:   2
    });


    // ── 2. NGO ADMINISTRATORS ────────────────────────────────────────────

    console.log('🌱 Seeding NGO administrators...');

    const ngoAdminUserId1 = id();
    const ngoAdminId1     = id();
    await UserAccount.create({
      userId:        ngoAdminUserId1,
      phoneNumber:   '+254700000010',
      hashedPassword: await hash('NgoAdmin@2026!'),
      userRole:      'NGO_ADMIN',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await NgoAdministratorProfile.create({
      ngoAdminId:               ngoAdminId1,
      userId:                   ngoAdminUserId1,
      administrativeDepartment: 'Case Management',
      administratorAccessLevel: 2
    });

    const ngoAdminUserId2 = id();
    const ngoAdminId2     = id();
    await UserAccount.create({
      userId:        ngoAdminUserId2,
      phoneNumber:   '+254700000011',
      hashedPassword: await hash('NgoAdmin2@2026!'),
      userRole:      'NGO_ADMIN',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await NgoAdministratorProfile.create({
      ngoAdminId:               ngoAdminId2,
      userId:                   ngoAdminUserId2,
      administrativeDepartment: 'Community Support',
      administratorAccessLevel: 1
    });


    // ── 3. COUNSELLORS ───────────────────────────────────────────────────

    console.log('🌱 Seeding counsellors...');

    const counsellorData = [
      { phone: '+254700000020', spec: 'Trauma Counselling',           county: 'Nairobi',    workload: 0 },
      { phone: '+254700000021', spec: 'Domestic Violence Support',    county: 'Mombasa',    workload: 0 },
      { phone: '+254700000022', spec: 'Psychosocial Support',         county: 'Kisumu',     workload: 0 }
    ];

    const counsellorIds = [];  // counsellorId values for assignment later
    const counsellorUserIds = [];

    for (const c of counsellorData) {
      const userId       = id();
      const counsellorId = id();
      counsellorUserIds.push(userId);
      counsellorIds.push({ counsellorId, county: c.county });

      await UserAccount.create({
        userId,
        phoneNumber:   c.phone,
        hashedPassword: await hash('Counsellor@2026!'),
        userRole:      'COUNSELLOR',
        accountStatus: 'ACTIVE',
        isOtpVerified: true
      });
      await CounsellorProfile.create({
        counsellorId,
        userId,
        professionalSpecialization: c.spec,
        currentWorkloadScore:       c.workload,
        availabilityStatus:         'AVAILABLE'
      });
    }


    // ── 4. LEGAL COUNSEL ─────────────────────────────────────────────────

    console.log('🌱 Seeding legal counsel...');

    const legalData = [
      { phone: '+254700000030', spec: 'Family Law',        county: 'Nairobi',  workload: 0 },
      { phone: '+254700000031', spec: 'Criminal Law',      county: 'Mombasa',  workload: 0 },
      { phone: '+254700000032', spec: 'Human Rights Law',  county: 'Kisumu',   workload: 0 }
    ];

    const legalCounselIds = [];

    for (const l of legalData) {
      const userId        = id();
      const legalCounselId = id();
      legalCounselIds.push({ legalCounselId, county: l.county });

      await UserAccount.create({
        userId,
        phoneNumber:   l.phone,
        hashedPassword: await hash('LegalCounsel@2026!'),
        userRole:      'LEGAL_COUNSEL',
        accountStatus: 'ACTIVE',
        isOtpVerified: true
      });
      await LegalCounselProfile.create({
        legalCounselId,
        userId,
        professionalSpecialization: l.spec,
        currentWorkloadScore:       l.workload,
        availabilityStatus:         'AVAILABLE'
      });
    }


    // ── 5. SURVIVORS ─────────────────────────────────────────────────────

    console.log('🌱 Seeding survivors...');

    /**
     * Auto-assignment logic:
     * Match survivor to counsellor and legal counsel in the same county.
     * Falls back to first available if no county match (simplified for seed).
     */
    function assignStaff(county, staffArray) {
      return staffArray.find(s => s.county === county) || staffArray[0];
    }

    const survivorData = [
      { phone: '+254711000001', nickname: 'Starlight',   gender: 'Female', county: 'Nairobi'  },
      { phone: '+254711000002', nickname: 'Brave Heart',  gender: 'Female', county: 'Nairobi'  },
      { phone: '+254711000003', nickname: 'Rising Dawn',  gender: 'Female', county: 'Mombasa'  },
      { phone: '+254711000004', nickname: 'Still Waters', gender: 'Male',   county: 'Kisumu'   },
      { phone: '+254711000005', nickname: 'New Horizon',  gender: 'Female', county: 'Mombasa'  }
    ];

    const survivorIds    = [];
    const survivorUserIds = [];

    for (const s of survivorData) {
      const userId     = id();
      const survivorId = id();
      survivorUserIds.push(userId);
      survivorIds.push(survivorId);

      // Match to staff in same county
      const assignedCounsellor   = assignStaff(s.county, counsellorIds);
      const assignedLegalCounsel = assignStaff(s.county, legalCounselIds);

      await UserAccount.create({
        userId,
        phoneNumber:   s.phone,
        hashedPassword: await hash('Survivor@2026!'),
        userRole:      'SURVIVOR',
        accountStatus: 'ACTIVE',
        isOtpVerified: true
      });

      await SurvivorProfile.create({
        survivorId,
        userId,
        displayNickname:        s.nickname,
        assignedGender:         s.gender,
        residenceCounty:        s.county,
        assignedCounsellorId:   assignedCounsellor.counsellorId,
        assignedLegalCounselId: assignedLegalCounsel.legalCounselId,
        privacyPreferencesJson: { notificationsEnabled: true }
      });

      // Record the initial assignment in the history table
      await StaffAssignmentHistory.create({
        assignmentHistoryId:      id(),
        survivorId,
        counsellorId:             assignedCounsellor.counsellorId,
        legalCounselId:           assignedLegalCounsel.legalCounselId,
        assignmentReason:         'Initial auto-assignment at registration'
      });
    }


    // ── 6. INCIDENT REPORTS ──────────────────────────────────────────────

    console.log('🌱 Seeding incident reports...');

    const reportId1 = id();
    const reportId2 = id();
    const reportId3 = id();

    await IncidentReport.create({
      reportId:               reportId1,
      survivorId:             survivorIds[0],
      incidentCategory:       'domestic_violence',
      severityLevel:          'HIGH',
      incidentDescriptionText: 'Repeated incidents at home over the past three months. Increasing frequency.',
      incidentLocation:       'Nairobi, Eastlands',
      incidentDate:           '2026-04-15',
      currentReportStatus:    'IN_PROGRESS',
      reportCreationTimestamp: daysAgo(29)
    });

    // Evidence file for report 1
    await EvidenceFile.create({
      evidenceFileId:             id(),
      reportId:                   reportId1,
      evidenceFileType:           'image',
      originalFileName:           'evidence_photo.jpg',
      fileSize:                   204800,
      mimeType:                   'image/jpeg',
      cloudinaryPublicIdentifier: `gbv_evidence_${id()}`,
      dynamicallySignedUrl:       'https://res.cloudinary.com/demo/image/upload/sample_signed.jpg'
    });

    await IncidentReport.create({
      reportId:               reportId2,
      survivorId:             survivorIds[1],
      incidentCategory:       'sexual_violence',
      severityLevel:          'CRITICAL',
      incidentDescriptionText: 'Incident occurred on the stated date. Medical attention was sought.',
      incidentLocation:       'Nairobi, CBD',
      incidentDate:           '2026-05-01',
      currentReportStatus:    'ESCALATED',
      reportCreationTimestamp: daysAgo(25)
    });

    // Legal case escalated from report 2
    await LegalCaseFile.create({
      legalCaseId:           id(),
      reportId:              reportId2,
      currentCaseStatus:     'UNDER_INVESTIGATION',
      generatedDocumentPath: 'https://res.cloudinary.com/demo/raw/upload/legal_case_doc.pdf'
    });

    await IncidentReport.create({
      reportId:               reportId3,
      survivorId:             survivorIds[2],
      incidentCategory:       'stalking',
      severityLevel:          'MEDIUM',
      incidentDescriptionText: 'Ongoing stalking behaviour from a known individual.',
      incidentLocation:       'Mombasa, Old Town',
      incidentDate:           '2026-05-10',
      currentReportStatus:    'SUBMITTED',
      reportCreationTimestamp: daysAgo(21)
    });

    const extraReports = [
      {
        survivorId: survivorIds[3],
        incidentCategory: 'economic_abuse',
        severityLevel: 'LOW',
        incidentDescriptionText: 'Partner controls all income and denies household support.',
        incidentLocation: 'Kisumu, Nyamasaria',
        incidentDate: '2026-03-22',
        currentReportStatus: 'UNDER_REVIEW',
        reportCreationTimestamp: daysAgo(17)
      },
      {
        survivorId: survivorIds[4],
        incidentCategory: 'physical_violence',
        severityLevel: 'HIGH',
        incidentDescriptionText: 'Recent assault with repeated threats.',
        incidentLocation: 'Mombasa, Kisauni',
        incidentDate: '2026-05-18',
        currentReportStatus: 'ACTIVE_SUPPORT',
        reportCreationTimestamp: daysAgo(14)
      },
      {
        survivorId: survivorIds[0],
        incidentCategory: 'psychological_abuse',
        severityLevel: 'MEDIUM',
        incidentDescriptionText: 'Persistent intimidation and isolation from family support.',
        incidentLocation: 'Nairobi, Kasarani',
        incidentDate: '2026-02-14',
        currentReportStatus: 'RESOLVED',
        reportCreationTimestamp: daysAgo(10)
      },
      {
        survivorId: survivorIds[1],
        incidentCategory: 'digital_harassment',
        severityLevel: 'MEDIUM',
        incidentDescriptionText: 'Ongoing threats through social media and messaging apps.',
        incidentLocation: 'Nairobi, South B',
        incidentDate: '2026-04-03',
        currentReportStatus: 'UNDER_INVESTIGATION',
        reportCreationTimestamp: daysAgo(6)
      },
      {
        survivorId: survivorIds[2],
        incidentCategory: 'child_protection',
        severityLevel: 'CRITICAL',
        incidentDescriptionText: 'Urgent child safety risk reported in household.',
        incidentLocation: 'Mombasa, Nyali',
        incidentDate: '2026-05-21',
        currentReportStatus: 'LEGAL_REVIEW',
        reportCreationTimestamp: daysAgo(2)
      }
    ];

    for (const report of extraReports) {
      await IncidentReport.create({ reportId: id(), ...report });
    }

    const bulkReportTemplates = [
      { category: 'physical_violence', severity: 'HIGH', status: 'UNDER_REVIEW', location: 'Nairobi, Embakasi' },
      { category: 'emotional_abuse', severity: 'MEDIUM', status: 'ACTIVE_SUPPORT', location: 'Mombasa, Bamburi' },
      { category: 'economic_abuse', severity: 'LOW', status: 'SUBMITTED', location: 'Kisumu, Kondele' },
      { category: 'digital_harassment', severity: 'MEDIUM', status: 'UNDER_INVESTIGATION', location: 'Nairobi, Kilimani' },
      { category: 'sexual_violence', severity: 'CRITICAL', status: 'LEGAL_REVIEW', location: 'Mombasa, Nyali' },
      { category: 'child_protection', severity: 'HIGH', status: 'UNDER_REVIEW', location: 'Kisumu, Mamboleo' }
    ];

    // Add more reports with denser activity around recent days to make trend shifts visible.
    const additionalReportDays = [28, 27, 24, 23, 20, 19, 16, 15, 12, 11, 8, 7, 5, 4, 3, 1];

    for (let i = 0; i < additionalReportDays.length; i += 1) {
      const template = bulkReportTemplates[i % bulkReportTemplates.length];
      const survivorId = survivorIds[i % survivorIds.length];

      await IncidentReport.create({
        reportId: id(),
        survivorId,
        incidentCategory: template.category,
        severityLevel: template.severity,
        incidentDescriptionText: `Follow-up seeded case ${i + 1} for analytics visibility and dashboard testing.`,
        incidentLocation: template.location,
        incidentDate: new Date(Date.now() - (additionalReportDays[i] + 2) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        currentReportStatus: template.status,
        reportCreationTimestamp: daysAgo(additionalReportDays[i])
      });
    }


    // ── 7. COMMUNITY ROOMS ───────────────────────────────────────────────

    console.log('🌱 Seeding community rooms...');

    const roomId1 = id();
    const roomId2 = id();

    await CommunityRoom.create({
      roomId:             roomId1,
      roomName:           'General Support Circle',
      roomDescriptionText: 'A safe space for survivors to share experiences and support each other.',
      createdByAdminId:   ngoAdminId1
    });

    await CommunityRoom.create({
      roomId:             roomId2,
      roomName:           'Legal Rights Awareness',
      roomDescriptionText: 'Resources and discussions around legal rights and the justice system.',
      createdByAdminId:   ngoAdminId2
    });

    // Add some survivors and staff to rooms
    for (let i = 0; i < 3; i++) {
      await RoomMembership.create({
        membershipId: id(),
        roomId:       roomId1,
        userId:       survivorUserIds[i]
      });
    }
    await RoomMembership.create({ membershipId: id(), roomId: roomId2, userId: survivorUserIds[0] });
    await RoomMembership.create({ membershipId: id(), roomId: roomId2, userId: survivorUserIds[3] });

    // Community messages — survivors post under their nicknames
    const commMsgId1 = id();
    const commMsgId2 = id();

    await CommunityMessage.create({
      communityMessageId:   commMsgId1,
      roomId:               roomId1,
      senderUserId:         survivorUserIds[0],
      publicMessageContent: 'Thank you for this space. It really helps to know others understand.'
    });

    await CommunityMessage.create({
      communityMessageId:   commMsgId2,
      roomId:               roomId1,
      senderUserId:         survivorUserIds[1],
      publicMessageContent: 'I found the legal resources here very helpful. Recommended!'
    });

    const additionalCommunityMessages = [
      { roomId: roomId1, senderUserId: survivorUserIds[0], publicMessageContent: 'Has anyone used the county safe-house referral process recently?' },
      { roomId: roomId1, senderUserId: survivorUserIds[2], publicMessageContent: 'Breathing exercises helped me today. Sharing this in case it helps someone else.' },
      { roomId: roomId2, senderUserId: survivorUserIds[3], publicMessageContent: 'Can someone explain what happens after filing a police abstract?' },
      { roomId: roomId2, senderUserId: survivorUserIds[0], publicMessageContent: 'The legal rights PDF answered many of my questions.' },
      { roomId: roomId2, senderUserId: survivorUserIds[4], publicMessageContent: 'I need guidance on obtaining protective orders.' },
      { roomId: roomId1, senderUserId: counsellorUserIds[1], publicMessageContent: 'Reminder: You can step away and come back later. Your pace matters.' }
    ];

    for (const message of additionalCommunityMessages) {
      await CommunityMessage.create({
        communityMessageId: id(),
        ...message
      });
    }

    // A flagged message for moderation testing
    const flaggedMsgId = id();
    await CommunityMessage.create({
      communityMessageId:   flaggedMsgId,
      roomId:               roomId1,
      senderUserId:         survivorUserIds[2],
      publicMessageContent: '[Test message flagged for moderation review]'
    });

    // Harmful content report on the flagged message
    await HarmfulContentReport.create({
      contentReportId:              id(),
      reportedCommunityMessageId:   flaggedMsgId,
      reporterUserId:               survivorUserIds[0],
      reportReasonText:             'This content felt inappropriate for this space.',
      moderationReviewStatus:       'PENDING'
    });

    // Moderation action taken on the flagged content
    await ModerationActionLog.create({
      moderationActionId:       id(),
      moderatorUserId:          ngoAdminUserId1,
      targetUserId:             survivorUserIds[2],
      moderationActionType:     'WARNING',
      moderationActionReason:   'Community guidelines reminder issued to user.'
    });


    // ── 8. DIRECT CHAT CHANNELS AND MESSAGES ────────────────────────────

    console.log('🌱 Seeding direct chat channels and messages...');

    /**
     * Create one counsellor channel for the first survivor.
     * In production this is created automatically at assignment time.
     */
    const chatId1 = id();
    await DirectChatChannel.create({
      chatId:                    chatId1,
      survivorId:                survivorIds[0],
      supportStaffCounterpartId: counsellorUserIds[0],
      chatChannelType:           'counsellor_channel',
      chatChannelStatus:         'active'
    });

    // A few messages in this channel
    await DirectChatMessage.create({
      messageId:               id(),
      chatId:                  chatId1,
      senderUserId:            survivorUserIds[0],
      // In production this would be ciphertext — plaintext used in seed only
      encryptedMessageContent: '[ENCRYPTED: Hello, I would like to talk about what happened.]',
      messageReadStatus:       'READ'
    });

    await DirectChatMessage.create({
      messageId:               id(),
      chatId:                  chatId1,
      senderUserId:            counsellorUserIds[0],
      encryptedMessageContent: '[ENCRYPTED: Thank you for reaching out. I am here to listen.]',
      messageReadStatus:       'UNREAD'
    });


    // ── 9. NOTIFICATIONS ─────────────────────────────────────────────────

    console.log('🌱 Seeding notifications...');

    /**
     * All notification messages follow the discreet wording policy (SSD §22.2).
     * No mention of GBV, counselling, or the platform's purpose.
     */
    await InAppNotification.create({
      notificationId:             id(),
      recipientUserId:            survivorUserIds[0],
      notificationCategoryType:   'NEW_MESSAGE',
      discreetNotificationMessage: 'You have a new message.',
      notificationReadStatus:     'UNREAD'
    });

    await InAppNotification.create({
      notificationId:             id(),
      recipientUserId:            survivorUserIds[1],
      notificationCategoryType:   'REPORT_UPDATE',
      discreetNotificationMessage: 'Your request has been updated.',
      notificationReadStatus:     'READ'
    });

    await InAppNotification.create({
      notificationId:             id(),
      recipientUserId:            counsellorUserIds[0],
      notificationCategoryType:   'ASSIGNMENT',
      discreetNotificationMessage: 'A new assignment has been made.',
      notificationReadStatus:     'READ'
    });

    await InAppNotification.create({
      notificationId:             id(),
      recipientUserId:            ngoAdminUserId1,
      notificationCategoryType:   'MODERATION_ALERT',
      discreetNotificationMessage: 'A moderation alert requires review.',
      notificationReadStatus:     'UNREAD'
    });


    // ── 10. SUPPORT RESOURCES ─────────────────────────────────────────────

    console.log('🌱 Seeding support resources...');

    const resources = [
      {
        title:    'GBV Emergency Hotlines — Kenya',
        category: 'emergency_hotlines',
        desc:     'A compiled list of 24/7 emergency hotlines for GBV survivors in Kenya.',
        url:      'https://example.com/resources/emergency-hotlines.pdf'
      },
      {
        title:    'Know Your Legal Rights',
        category: 'legal_guidance',
        desc:     'A plain-language guide to legal rights for GBV survivors under Kenyan law.',
        url:      'https://example.com/resources/legal-rights-guide.pdf'
      },
      {
        title:    'Safe Houses in Nairobi',
        category: 'shelters',
        desc:     'Directory of verified safe houses and shelters in the Nairobi region.',
        url:      'https://example.com/resources/nairobi-shelters.pdf'
      },
      {
        title:    'Healing After Trauma — Self-Help Guide',
        category: 'self_help',
        desc:     'Evidence-based self-help strategies for trauma recovery.',
        url:      'https://example.com/resources/trauma-recovery.pdf'
      },
      {
        title:    'Safety Planning Template',
        category: 'safety_planning',
        desc:     'A step-by-step personal safety plan template for survivors in active risk.',
        url:      'https://example.com/resources/safety-plan-template.pdf'
      },
      {
        title:    'County Referral Directory',
        category: 'service_directory',
        desc:     'County-by-county contacts for shelters, counselling, and legal support desks.',
        url:      'https://example.com/resources/county-referrals.pdf'
      },
      {
        title:    'Court Process Checklist',
        category: 'legal_guidance',
        desc:     'Step list of documents and milestones for GBV-related legal follow-up.',
        url:      'https://example.com/resources/court-process-checklist.pdf'
      },
      {
        title:    'Trauma-Informed Grounding Exercises',
        category: 'self_help',
        desc:     'Quick grounding and regulation practices for high-stress moments.',
        url:      'https://example.com/resources/grounding-exercises.pdf'
      }
    ];

    for (const r of resources) {
      await SupportResource.create({
        resourceId:              id(),
        resourceTitle:           r.title,
        resourceDescription:     r.desc,
        resourceCategory:        r.category,
        resourceFileUrl:         r.url,
        uploadedByStaffId:       ngoAdminUserId1
      });
    }


    // ── 11. OTP REQUESTS ─────────────────────────────────────────────────

    console.log('🌱 Seeding OTP verification requests...');

    // Simulate one pending OTP and one verified OTP
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now

    await OtpVerificationRequest.create({
      otpRequestId:         id(),
      targetPhoneNumber:    '+254711000099',
      hashedOtpCode:        await hash('482910'), // Hash of test OTP
      otpExpirationTimestamp: otpExpiry,
      otpVerificationStatus: 'PENDING'
    });

    await OtpVerificationRequest.create({
      otpRequestId:         id(),
      targetPhoneNumber:    '+254711000001',
      hashedOtpCode:        await hash('193847'),
      otpExpirationTimestamp: new Date(Date.now() - 60000), // Already expired
      otpVerificationStatus: 'VERIFIED'
    });


    // ── 12. USSD CALLBACK REQUESTS ───────────────────────────────────────

    console.log('🌱 Seeding USSD callback requests...');

    await UssdCallbackRequest.create({
      callbackRequestId:        id(),
      requesterPhoneNumber:     '+254722000001',
      callbackFulfillmentStatus: 'PENDING'
    });

    await UssdCallbackRequest.create({
      callbackRequestId:        id(),
      requesterPhoneNumber:     '+254722000002',
      callbackFulfillmentStatus: 'COMPLETED'
    });


    // ── 13. AUDIT LOG ENTRIES ────────────────────────────────────────────

    console.log('🌱 Seeding audit log entries...');

    await AuditLog.create({
      auditId:       id(),
      actorUserId:   survivorUserIds[0],
      actionType:    'LOGIN',
      targetEntity:  null
    });

    await AuditLog.create({
      auditId:       id(),
      actorUserId:   survivorUserIds[0],
      actionType:    'REPORT_SUBMITTED',
      targetEntity:  'incidentReport'
    });

    await AuditLog.create({
      auditId:       id(),
      actorUserId:   ngoAdminUserId1,
      actionType:    'COMMUNITY_ROOM_CREATED',
      targetEntity:  'communityRoom'
    });


    console.log('\n✅ Database seeded successfully.');
    console.log('─────────────────────────────────────────');
    console.log('  System Admins:   2');
    console.log('  NGO Admins:      2');
    console.log('  Counsellors:     3');
    console.log('  Legal Counsel:   3');
    console.log('  Survivors:       5');
    console.log('  Reports:         24 (1 escalated to legal case)');
    console.log('  Community Rooms: 2');
    console.log('  Resources:       8');
    console.log('─────────────────────────────────────────\n');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);

  } finally {
    await sequelize.close();
    console.log('🔒 Database connection closed.');
  }
}

seed();