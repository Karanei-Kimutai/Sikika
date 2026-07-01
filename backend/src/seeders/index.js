/**
 * seeders/index.js
 * ----------------
 * Database seeder — populates the database with realistic test data
 * for development and testing purposes.
 *
 * This seeder creates:
 *   - 1 moderator
 *   - 2 NGO administrators
 *   - 3 counsellors
 *   - 3 legal counsel
 *   - 5 survivors (each auto-assigned to a counsellor and legal counsel)
 *   - Incident reports (multiple statuses; one escalated to legal case)
 *   - Community rooms, memberships, and messages (incl. two flagged messages)
 *   - Direct chat channels and messages for each survivor↔staff pair
 *     (incl. one archived and one deleted channel for Trash/Restore testing)
 *   - Notifications, resources, moderation logs
 *   - OTP requests and USSD callback requests
 *
 * Usage:
 *   node src/seeders/index.js
 *
 * WARNING: This script uses { force: true } on sync — it DROPS and recreates
 * all tables before seeding. Only run in development. NEVER run against a
 * production database. The hard guard below aborts if NODE_ENV=production.
 */

require('dotenv').config();

// ── Hard production guard ──────────────────────────────────────────────────
// The force-reset sync will DROP all tables. This cannot be undone. Abort
// immediately when running in a production environment.
if (process.env.NODE_ENV === 'production') {
  console.error(
    '❌ ABORTED: seeders/index.js must not run in a production environment.\n' +
    '   NODE_ENV=production detected. This seeder uses sync({ force: true })\n' +
    '   which DROPS all tables. Unset NODE_ENV or change it to "development".'
  );
  process.exit(1);
}

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const {
  uploadSupportResourceBuffer,
  uploadEvidenceBuffer,
  uploadLegalDocumentBuffer
} = require('../config/cloudinary');
const { buildLegalCasePdfBuffer } = require('../services/legalDocumentService');
const {
  sequelize,
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  ModeratorProfile,
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
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hash(plaintext) {
  return bcrypt.hash(plaintext, 12);
}

// ── Helper: generate a UUID ────────────────────────────────────────────────
const id = () => uuidv4();

/**
 * Returns a Date set to 10:00 AM on `days` days ago.
 * @param {number} days
 * @returns {Date}
 */
function daysAgo(days) {
  const date = new Date();
  date.setHours(10, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

// ── Helper: render a simple one-page PDF into a Buffer ─────────────────────
/**
 * Renders a short PDF (title + body paragraph) into a Buffer using pdfkit —
 * the same library the real legal-document generation path uses. Seeded
 * resources/evidence upload this buffer to Cloudinary via the same helpers
 * (`uploadSupportResourceBuffer`, `uploadEvidenceBuffer`) the live app uses,
 * so seeded files are real, downloadable Cloudinary assets rather than
 * placeholder URLs.
 * @param {{ title: string, body: string }} options
 * @returns {Promise<Buffer>}
 */
function buildSimplePdfBuffer({ title, body }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor('#6c3483').fontSize(16).font('Helvetica-Bold').text(title);
    doc.moveDown(1);
    doc.fillColor('#2c2c2c').fontSize(11).font('Helvetica').text(body, { lineGap: 4 });

    doc.end();
  });
}

// ── A minimal valid 1x1 PNG, used as seeded evidence "photo" bytes ─────────
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';


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


    // ── 1. MODERATORS ─────────────────────────────────────────────────────

    console.log('🌱 Seeding moderators...');

    const moderatorUserId1 = id();
    await UserAccount.create({
      userId:        moderatorUserId1,
      phoneNumber:   '+254700000001',
      hashedPassword: await hash('Moderator@2026!'),
      userRole:      'MODERATOR',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    });
    await ModeratorProfile.create({
      moderatorId:           id(),
      userId:                moderatorUserId1,
      currentWorkloadScore:  0
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
      { phone: '+254700000020', spec: 'Trauma Counselling',        county: 'Nairobi', workload: 0 },
      { phone: '+254700000021', spec: 'Domestic Violence Support', county: 'Mombasa', workload: 0 },
      { phone: '+254700000022', spec: 'Psychosocial Support',      county: 'Kisumu',  workload: 0 }
    ];

    const counsellorIds    = [];  // { counsellorId, county } — for survivor assignment
    const counsellorUserIds = []; // UserAccount userId — for channel population

    for (const c of counsellorData) {
      const userId       = id();
      const counsellorId = id();
      counsellorUserIds.push(userId);
      counsellorIds.push({ counsellorId, county: c.county });

      await UserAccount.create({
        userId,
        phoneNumber:    c.phone,
        hashedPassword: await hash('Counsellor@2026!'),
        userRole:       'COUNSELLOR',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
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
      { phone: '+254700000030', spec: 'Family Law',       county: 'Nairobi', workload: 0 },
      { phone: '+254700000031', spec: 'Criminal Law',     county: 'Mombasa', workload: 0 },
      { phone: '+254700000032', spec: 'Human Rights Law', county: 'Kisumu',  workload: 0 }
    ];

    const legalCounselIds     = [];  // { legalCounselId, county } — for survivor assignment
    const legalCounselUserIds = [];  // UserAccount userId — for channel population

    for (const l of legalData) {
      const userId         = id();
      const legalCounselId = id();
      legalCounselUserIds.push(userId);
      legalCounselIds.push({ legalCounselId, county: l.county });

      await UserAccount.create({
        userId,
        phoneNumber:    l.phone,
        hashedPassword: await hash('LegalCounsel@2026!'),
        userRole:       'LEGAL_COUNSEL',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
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
     * Auto-assignment: match survivor to counsellor/legal counsel in the same county.
     * Falls back to first available if no county match (simplified for seed).
     * @param {string} county
     * @param {Array<object>} staffArray
     */
    function assignStaff(county, staffArray) {
      return staffArray.find(s => s.county === county) || staffArray[0];
    }

    const survivorData = [
      { phone: '+254711000001', nickname: 'Starlight',    gender: 'Female', county: 'Nairobi' },
      { phone: '+254711000002', nickname: 'Brave Heart',  gender: 'Female', county: 'Nairobi' },
      { phone: '+254711000003', nickname: 'Rising Dawn',  gender: 'Female', county: 'Mombasa' },
      { phone: '+254711000004', nickname: 'Still Waters', gender: 'Male',   county: 'Kisumu'  },
      { phone: '+254711000005', nickname: 'New Horizon',  gender: 'Female', county: 'Mombasa' }
    ];

    const survivorIds         = [];
    const survivorUserIds     = [];
    // Persist assignment pairing keyed by index for channel verification later.
    const survivorAssignments = [];

    for (const s of survivorData) {
      const userId     = id();
      const survivorId = id();
      survivorUserIds.push(userId);
      survivorIds.push(survivorId);

      const assignedCounsellor   = assignStaff(s.county, counsellorIds);
      const assignedLegalCounsel = assignStaff(s.county, legalCounselIds);

      // Resolve UserAccount userIds for channel wiring.
      const counsellorUserId   = counsellorUserIds[counsellorIds.indexOf(assignedCounsellor)];
      const legalCounselUserId = legalCounselUserIds[legalCounselIds.indexOf(assignedLegalCounsel)];
      survivorAssignments.push({
        survivorId,
        counsellorUserId,
        legalCounselUserId,
        counsellorId:   assignedCounsellor.counsellorId,
        legalCounselId: assignedLegalCounsel.legalCounselId
      });

      await UserAccount.create({
        userId,
        phoneNumber:    s.phone,
        hashedPassword: await hash('Survivor@2026!'),
        userRole:       'SURVIVOR',
        accountStatus:  'ACTIVE',
        isOtpVerified:  true
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

      await StaffAssignmentHistory.create({
        assignmentHistoryId: id(),
        survivorId,
        counsellorId:        assignedCounsellor.counsellorId,
        legalCounselId:      assignedLegalCounsel.legalCounselId,
        assignmentReason:    'Initial auto-assignment at registration'
      });
    }


    // ── 6. INCIDENT REPORTS ──────────────────────────────────────────────

    console.log('🌱 Seeding incident reports...');

    const reportId1 = id();
    const reportId2 = id();
    const reportId3 = id();

    await IncidentReport.create({
      reportId:                reportId1,
      survivorId:              survivorIds[0],
      incidentCategory:        'domestic_violence',
      severityLevel:           'HIGH',
      incidentDescriptionText: 'Repeated incidents at home over the past three months. Increasing frequency.',
      incidentLocation:        'Nairobi, Eastlands',
      incidentDate:            '2026-04-15',
      currentReportStatus:     'UNDER_REVIEW',
      reportCreationTimestamp: daysAgo(29)
    });

    // Real Cloudinary upload — makes GET /api/reports/:id/evidence/:id/file
    // actually streamable instead of pointing at a fake public_id.
    const evidencePhotoBuffer = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64');
    const evidencePhotoUpload = await uploadEvidenceBuffer({
      buffer:   evidencePhotoBuffer,
      reportId: reportId1,
      mimeType: 'image/png'
    });
    await EvidenceFile.create({
      evidenceFileId:             id(),
      reportId:                   reportId1,
      evidenceFileType:           'image',
      originalFileName:           'evidence_photo.png',
      fileSize:                   evidencePhotoBuffer.length,
      mimeType:                   'image/png',
      cloudinaryPublicIdentifier: evidencePhotoUpload.public_id,
      dynamicallySignedUrl:       evidencePhotoUpload.secure_url
    });

    await IncidentReport.create({
      reportId:                reportId2,
      survivorId:              survivorIds[1],
      incidentCategory:        'sexual_violence',
      severityLevel:           'CRITICAL',
      incidentDescriptionText: 'Incident occurred on the stated date. Medical attention was sought.',
      incidentLocation:        'Nairobi, CBD',
      incidentDate:            '2026-05-01',
      currentReportStatus:     'ESCALATED_TO_LEGAL_CASE',
      reportCreationTimestamp: daysAgo(25)
    });

    // Second evidence type (PDF) on the escalated report for coverage variety.
    const evidenceDocBuffer = await buildSimplePdfBuffer({
      title: 'Incident Documentation — Medical Note Summary',
      body:  'Summary note prepared following the incident described in this report. ' +
             'Attached for reference by the assigned counsellor and legal counsel during case review.'
    });
    const evidenceDocUpload = await uploadEvidenceBuffer({
      buffer:   evidenceDocBuffer,
      reportId: reportId2,
      mimeType: 'application/pdf'
    });
    await EvidenceFile.create({
      evidenceFileId:             id(),
      reportId:                   reportId2,
      evidenceFileType:           'pdf',
      originalFileName:           'incident_documentation.pdf',
      fileSize:                   evidenceDocBuffer.length,
      mimeType:                   'application/pdf',
      cloudinaryPublicIdentifier: evidenceDocUpload.public_id,
      dynamicallySignedUrl:       evidenceDocUpload.secure_url
    });

    // ── Legal case A — fully drafted + document already generated ─────────
    // Lets the assigned legal counsel (+254700000030) click "Open Document"
    // and download a real PDF immediately, without generating one first.
    const legalCaseId2 = id();
    const legalCaseDraftA = {
      legalCaseId:         legalCaseId2,
      reportId:            reportId2,
      currentCaseStatus:   'UNDER_INVESTIGATION',
      escalationTimestamp: daysAgo(25),
      caseSummary:
        'Survivor reported a sexual violence incident in Nairobi CBD on 2026-05-01. ' +
        'Medical attention was sought the same day. Survivor has been referred for ' +
        'ongoing counselling support and has consented to legal escalation.',
      legalGroundsText:
        'Sexual Offences Act (2006), Section 3 — defilement/sexual assault provisions. ' +
        'Penal Code Cap. 63 also considered for concurrent charges.',
      requestedReliefText:
        'Criminal prosecution referral to the Office of the Director of Public Prosecutions. ' +
        'Interim protection order requested pending investigation outcome.',
      recommendedActionsText:
        'Refer case file to DPP liaison desk. Coordinate forensic medical examination follow-up. ' +
        'Schedule survivor statement recording with assigned investigating officer.',
      draftLastUpdatedAt: daysAgo(20)
    };
    const legalDocBuffer = await buildLegalCasePdfBuffer(legalCaseDraftA, {
      reportId:      reportId2,
      category:      'sexual_violence',
      severityLevel: 'CRITICAL',
      date:          '2026-05-01',
      location:      'Nairobi, CBD'
    });
    const legalDocUpload = await uploadLegalDocumentBuffer({ buffer: legalDocBuffer, legalCaseId: legalCaseId2 });
    await LegalCaseFile.create({
      ...legalCaseDraftA,
      generatedDocumentPath: legalDocUpload.public_id,
      documentGeneratedAt:   daysAgo(19)
    });

    await IncidentReport.create({
      reportId:                reportId3,
      survivorId:              survivorIds[2],
      incidentCategory:        'stalking',
      severityLevel:           'MEDIUM',
      incidentDescriptionText: 'Ongoing stalking behaviour from a known individual.',
      incidentLocation:        'Mombasa, Old Town',
      incidentDate:            '2026-05-10',
      currentReportStatus:     'SUBMITTED',
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
      }
    ];

    for (const report of extraReports) {
      await IncidentReport.create({ reportId: id(), ...report });
    }

    // Kept separate (rather than inside extraReports) so its reportId can be
    // captured for a companion LegalCaseFile — this is Case B: an empty legal
    // case (no draft, no generated document) for testing the full manual
    // Save Draft → Generate Document → Open Document flow as legal counsel
    // +254700000031 (assigned to this Mombasa survivor).
    const legalReviewReportId = id();
    await IncidentReport.create({
      reportId:                legalReviewReportId,
      survivorId:              survivorIds[2],
      incidentCategory:        'child_protection',
      severityLevel:           'CRITICAL',
      incidentDescriptionText: 'Urgent child safety risk reported in household.',
      incidentLocation:        'Mombasa, Nyali',
      incidentDate:            '2026-05-21',
      currentReportStatus:     'LEGAL_REVIEW',
      reportCreationTimestamp: daysAgo(2)
    });

    await LegalCaseFile.create({
      legalCaseId:         id(),
      reportId:            legalReviewReportId,
      currentCaseStatus:   'OPEN',
      escalationTimestamp: daysAgo(2)
    });

    const bulkReportTemplates = [
      { category: 'physical_violence',  severity: 'HIGH',     status: 'UNDER_REVIEW',         location: 'Nairobi, Embakasi' },
      { category: 'emotional_abuse',    severity: 'MEDIUM',   status: 'ACTIVE_SUPPORT',        location: 'Mombasa, Bamburi'  },
      { category: 'economic_abuse',     severity: 'LOW',      status: 'SUBMITTED',             location: 'Kisumu, Kondele'   },
      { category: 'digital_harassment', severity: 'MEDIUM',   status: 'UNDER_INVESTIGATION',   location: 'Nairobi, Kilimani' },
      { category: 'sexual_violence',    severity: 'CRITICAL', status: 'LEGAL_REVIEW',          location: 'Mombasa, Nyali'    },
      { category: 'child_protection',   severity: 'HIGH',     status: 'UNDER_REVIEW',          location: 'Kisumu, Mamboleo'  }
    ];

    // Dense activity around recent days for trend-chart visibility.
    const additionalReportDays = [28, 27, 24, 23, 20, 19, 16, 15, 12, 11, 8, 7, 5, 4, 3, 1];

    for (let i = 0; i < additionalReportDays.length; i += 1) {
      const template   = bulkReportTemplates[i % bulkReportTemplates.length];
      const survivorId = survivorIds[i % survivorIds.length];

      await IncidentReport.create({
        reportId: id(),
        survivorId,
        incidentCategory:        template.category,
        severityLevel:           template.severity,
        incidentDescriptionText: `Follow-up seeded case ${i + 1} for analytics visibility and dashboard testing.`,
        incidentLocation:        template.location,
        incidentDate:            new Date(Date.now() - (additionalReportDays[i] + 2) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        currentReportStatus:     template.status,
        reportCreationTimestamp: daysAgo(additionalReportDays[i])
      });
    }


    // ── 7. COMMUNITY ROOMS ───────────────────────────────────────────────

    console.log('🌱 Seeding community rooms...');

    const roomId1 = id();
    const roomId2 = id();

    await CommunityRoom.create({
      roomId:              roomId1,
      roomName:            'General Support Circle',
      roomDescriptionText: 'A safe space for survivors to share experiences and support each other.',
      createdByAdminId:    ngoAdminId1
    });

    await CommunityRoom.create({
      roomId:              roomId2,
      roomName:            'Legal Rights Awareness',
      roomDescriptionText: 'Resources and discussions around legal rights and the justice system.',
      createdByAdminId:    ngoAdminId2
    });

    // Room memberships
    for (let i = 0; i < 3; i++) {
      await RoomMembership.create({ membershipId: id(), roomId: roomId1, userId: survivorUserIds[i] });
    }
    await RoomMembership.create({ membershipId: id(), roomId: roomId2, userId: survivorUserIds[0] });
    await RoomMembership.create({ membershipId: id(), roomId: roomId2, userId: survivorUserIds[3] });
    await RoomMembership.create({ membershipId: id(), roomId: roomId2, userId: survivorUserIds[4] });

    // Community messages
    await CommunityMessage.create({
      communityMessageId:   id(),
      roomId:               roomId1,
      senderUserId:         survivorUserIds[0],
      publicMessageContent: 'Thank you for this space. It really helps to know others understand.'
    });
    await CommunityMessage.create({
      communityMessageId:   id(),
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
      { roomId: roomId1, senderUserId: counsellorUserIds[1], publicMessageContent: 'Reminder: You can step away and come back later. Your pace matters.' },
      { roomId: roomId1, senderUserId: survivorUserIds[3], publicMessageContent: 'Small steps forward still count. Today was hard but I am still here.' },
      { roomId: roomId2, senderUserId: survivorUserIds[1], publicMessageContent: 'Is there a template for documenting incidents for legal purposes?' }
    ];

    for (const message of additionalCommunityMessages) {
      await CommunityMessage.create({ communityMessageId: id(), ...message });
    }

    // Flagged message #1 — for moderation queue testing
    const flaggedMsgId1 = id();
    await CommunityMessage.create({
      communityMessageId:   flaggedMsgId1,
      roomId:               roomId1,
      senderUserId:         survivorUserIds[2],
      publicMessageContent: '[Test message flagged for moderation review]'
    });
    await HarmfulContentReport.create({
      contentReportId:            id(),
      reportedCommunityMessageId: flaggedMsgId1,
      reporterUserId:             survivorUserIds[0],
      reportReasonText:           'This content felt inappropriate for this space.',
      moderationReviewStatus:     'PENDING'
    });

    // Flagged message #2 — second moderation case for queue depth testing
    const flaggedMsgId2 = id();
    await CommunityMessage.create({
      communityMessageId:   flaggedMsgId2,
      roomId:               roomId2,
      senderUserId:         survivorUserIds[4],
      publicMessageContent: '[Second test message flagged for moderation review]'
    });
    await HarmfulContentReport.create({
      contentReportId:            id(),
      reportedCommunityMessageId: flaggedMsgId2,
      reporterUserId:             survivorUserIds[3],
      reportReasonText:           'Message made me feel unsafe.',
      moderationReviewStatus:     'PENDING'
    });

    // Moderation warning for flagged message #1
    await ModerationActionLog.create({
      moderationActionId:     id(),
      moderatorUserId:        ngoAdminUserId1,
      targetUserId:           survivorUserIds[2],
      moderationActionType:   'WARNING',
      moderationActionReason: 'Community guidelines reminder issued to user.'
    });


    // ── 8. DIRECT CHAT CHANNELS AND MESSAGES ────────────────────────────

    console.log('🌱 Seeding direct chat channels and messages...');

    /**
     * Provision one counsellor_channel and one legal_counsel_channel per survivor.
     * In production these are created by ensureAutoChannelsForSurvivor.
     * The seeder provisions them explicitly so the DB is fully usable without a
     * prior server run.
     *
     * Special channel statuses for UI feature testing:
     *   Survivor[2]↔counsellor  → "archived"  (Archive/Restore UI flow)
     *   Survivor[3]↔legal        → "deleted"   (Trash/Restore UI flow, Item 2)
     */
    const seededChannels = [];

    for (let i = 0; i < survivorIds.length; i++) {
      const assignment = survivorAssignments[i];

      const counsellorChannelStatus = (i === 2) ? 'archived' : 'active';
      const legalChannelStatus      = (i === 3) ? 'deleted'  : 'active';

      // ── Counsellor channel ─────────────────────────────────────────────
      const counsellorChatId = id();
      await DirectChatChannel.create({
        chatId:                    counsellorChatId,
        survivorId:                assignment.survivorId,
        supportStaffCounterpartId: assignment.counsellorUserId,
        chatChannelType:           'counsellor_channel',
        chatChannelStatus:         counsellorChannelStatus
      });
      seededChannels.push({
        chatId:      counsellorChatId,
        survivorId:  assignment.survivorId,
        channelType: 'counsellor_channel',
        staffUserId: assignment.counsellorUserId,
        status:      counsellorChannelStatus
      });

      if (counsellorChannelStatus === 'active') {
        await DirectChatMessage.create({
          messageId:               id(),
          chatId:                  counsellorChatId,
          senderUserId:            survivorUserIds[i],
          encryptedMessageContent: '[ENCRYPTED: Hello, I would like to talk about what happened.]',
          messageReadStatus:       'READ'
        });
        await DirectChatMessage.create({
          messageId:               id(),
          chatId:                  counsellorChatId,
          senderUserId:            assignment.counsellorUserId,
          encryptedMessageContent: '[ENCRYPTED: Thank you for reaching out. I am here to listen.]',
          messageReadStatus:       'UNREAD'
        });
        if (i === 0) {
          // Extra thread for the primary demo survivor
          await DirectChatMessage.create({
            messageId:               id(),
            chatId:                  counsellorChatId,
            senderUserId:            survivorUserIds[0],
            encryptedMessageContent: '[ENCRYPTED: I have a follow-up question about the next steps.]',
            messageReadStatus:       'UNREAD'
          });
        }
      }

      // ── Legal counsel channel ──────────────────────────────────────────
      const legalChatId = id();
      await DirectChatChannel.create({
        chatId:                    legalChatId,
        survivorId:                assignment.survivorId,
        supportStaffCounterpartId: assignment.legalCounselUserId,
        chatChannelType:           'legal_counsel_channel',
        chatChannelStatus:         legalChannelStatus
      });
      seededChannels.push({
        chatId:      legalChatId,
        survivorId:  assignment.survivorId,
        channelType: 'legal_counsel_channel',
        staffUserId: assignment.legalCounselUserId,
        status:      legalChannelStatus
      });

      if (legalChannelStatus === 'active') {
        await DirectChatMessage.create({
          messageId:               id(),
          chatId:                  legalChatId,
          senderUserId:            survivorUserIds[i],
          encryptedMessageContent: '[ENCRYPTED: I would like legal advice on the next steps I can take.]',
          messageReadStatus:       'READ'
        });
        await DirectChatMessage.create({
          messageId:               id(),
          chatId:                  legalChatId,
          senderUserId:            assignment.legalCounselUserId,
          encryptedMessageContent: '[ENCRYPTED: I have reviewed the information. Here are your available options.]',
          messageReadStatus:       'UNREAD'
        });
      }
    }


    // ── 9. DATA INTEGRITY GUARD ──────────────────────────────────────────

    console.log('🔍 Running post-seed data integrity checks...');

    /**
     * Assert every survivor has exactly one counsellor_channel and one
     * legal_counsel_channel, and each points to the assigned staff member.
     * Fails loudly on any broken link so problems surface at seed time.
     */
    for (let i = 0; i < survivorIds.length; i++) {
      const assignment = survivorAssignments[i];
      const survivorChannels = seededChannels.filter(c => c.survivorId === assignment.survivorId);

      const counsellorChannels   = survivorChannels.filter(c => c.channelType === 'counsellor_channel');
      const legalCounselChannels = survivorChannels.filter(c => c.channelType === 'legal_counsel_channel');

      if (counsellorChannels.length !== 1) {
        throw new Error(
          `Seed integrity check failed: survivor[${i}] (${assignment.survivorId}) ` +
          `has ${counsellorChannels.length} counsellor_channel(s); expected 1.`
        );
      }
      if (legalCounselChannels.length !== 1) {
        throw new Error(
          `Seed integrity check failed: survivor[${i}] (${assignment.survivorId}) ` +
          `has ${legalCounselChannels.length} legal_counsel_channel(s); expected 1.`
        );
      }

      // Verify channel → assignment link (catches mismatched userIds).
      if (counsellorChannels[0].staffUserId !== assignment.counsellorUserId) {
        throw new Error(
          `Seed assignment-link check failed: survivor[${i}] counsellor channel ` +
          `points to ${counsellorChannels[0].staffUserId} but assigned userId is ${assignment.counsellorUserId}.`
        );
      }
      if (legalCounselChannels[0].staffUserId !== assignment.legalCounselUserId) {
        throw new Error(
          `Seed assignment-link check failed: survivor[${i}] legal_counsel channel ` +
          `points to ${legalCounselChannels[0].staffUserId} but assigned userId is ${assignment.legalCounselUserId}.`
        );
      }
    }

    console.log('✅ Integrity checks passed: all survivors have correct counsellor and legal-counsel channels.');


    // ── 10. NOTIFICATIONS ─────────────────────────────────────────────────

    console.log('🌱 Seeding notifications...');

    /**
     * All notification messages use discreet wording per SSD §22.2.
     * No mention of GBV, counselling, or the platform's purpose.
     */
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[0],
      notificationCategoryType:    'NEW_MESSAGE',
      discreetNotificationMessage: 'You have a new message.',
      notificationReadStatus:      'UNREAD'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[1],
      notificationCategoryType:    'REPORT_UPDATE',
      discreetNotificationMessage: 'Your request has been updated.',
      notificationReadStatus:      'READ'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             counsellorUserIds[0],
      notificationCategoryType:    'ASSIGNMENT',
      discreetNotificationMessage: 'A new assignment has been made.',
      notificationReadStatus:      'READ'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             ngoAdminUserId1,
      notificationCategoryType:    'MODERATION_ALERT',
      discreetNotificationMessage: 'A moderation alert requires review.',
      notificationReadStatus:      'UNREAD'
    });
    await InAppNotification.create({
      notificationId:              id(),
      recipientUserId:             survivorUserIds[2],
      notificationCategoryType:    'NEW_MESSAGE',
      discreetNotificationMessage: 'You have a new message.',
      notificationReadStatus:      'UNREAD'
    });


    // ── 11. SUPPORT RESOURCES ─────────────────────────────────────────────

    console.log('🌱 Seeding support resources...');

    const resources = [
      { title: 'GBV Emergency Hotlines — Kenya',      category: 'emergency_hotlines', desc: 'A compiled list of 24/7 emergency hotlines for GBV survivors in Kenya.',
        body: 'National GBV Helpline: 1195 (toll-free, 24/7). Childline Kenya: 116 (toll-free, 24/7). ' +
              'Kenya Police Emergency: 999 / 112. FIDA Kenya Legal Aid: +254 20 3874927. ' +
              'Nairobi Women\'s Hospital Gender Violence Recovery Centre: +254 719 638 006. ' +
              'These lines are staffed around the clock and can connect you to counselling, medical, and legal referrals.' },
      { title: 'Know Your Legal Rights',              category: 'legal_guidance',     desc: 'A plain-language guide to legal rights for GBV survivors under Kenyan law.',
        body: 'Under the Protection Against Domestic Violence Act (2015) and the Sexual Offences Act (2006), survivors ' +
              'have the right to seek protection orders, report incidents without discrimination, access free legal aid ' +
              'through the National Legal Aid Service, and request confidentiality throughout investigation and trial.' },
      { title: 'Safe Houses in Nairobi',              category: 'shelters',           desc: 'Directory of verified safe houses and shelters in the Nairobi region.',
        body: 'Verified shelters accept referrals through this platform\'s assigned counsellors. Intake typically requires ' +
              'a brief safety assessment. Most facilities provide short-term accommodation, meals, and access to ' +
              'counselling while a longer-term safety plan is arranged.' },
      { title: 'Healing After Trauma — Self-Help',    category: 'self_help',          desc: 'Evidence-based self-help strategies for trauma recovery.',
        body: 'Grounding techniques, journaling prompts, and breathing exercises drawn from trauma-informed care practice. ' +
              'These are not a substitute for professional counselling but can help manage acute distress between sessions.' },
      { title: 'Safety Planning Template',            category: 'safety_planning',    desc: 'A step-by-step personal safety plan template for survivors in active risk.',
        body: 'Identify a trusted contact and a code word, pack an emergency bag with ID and essential documents, ' +
              'memorise at least one emergency number, and plan a safe exit route from home and workplace in advance.' },
      { title: 'County Referral Directory',           category: 'service_directory',  desc: 'County-by-county contacts for shelters, counselling, and legal support desks.',
        body: 'Nairobi, Mombasa, and Kisumu county desks are listed with office hours and walk-in policy. Contact your ' +
              'assigned counsellor for a warm handover to the nearest listed service point.' },
      { title: 'Court Process Checklist',             category: 'legal_guidance',     desc: 'Step list of documents and milestones for GBV-related legal follow-up.',
        body: 'Police abstract obtained, medical report (P3 form) completed, statement recorded, protection order filed ' +
              'if needed, and court mention date confirmed. Your assigned legal counsel tracks each milestone with you.' },
      { title: 'Trauma-Informed Grounding Exercises', category: 'self_help',          desc: 'Quick grounding and regulation practices for high-stress moments.',
        body: 'The 5-4-3-2-1 technique: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste. ' +
              'Paired with slow diaphragmatic breathing, this can help interrupt an acute stress response within minutes.' }
    ];

    for (const r of resources) {
      const resourceId = id();
      const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const originalFileName = `${slug}.pdf`;

      // Real one-page PDF uploaded to Cloudinary — makes
      // GET /api/resources/:id/file actually streamable.
      const resourcePdfBuffer = await buildSimplePdfBuffer({ title: r.title, body: r.body });
      const uploaded = await uploadSupportResourceBuffer({
        buffer: resourcePdfBuffer,
        resourceId,
        category: r.category,
        originalFileName,
        mimeType: 'application/pdf'
      });

      await SupportResource.create({
        resourceId,
        resourceTitle:          r.title,
        resourceDescription:    r.desc,
        resourceCategory:       r.category,
        resourceFileUrl:        uploaded.secure_url,
        cloudinaryPublicId:     uploaded.public_id,
        cloudinaryResourceType: uploaded.resource_type,
        originalFileName,
        mimeType:               'application/pdf',
        fileSizeBytes:          resourcePdfBuffer.length,
        uploadedByStaffId:      ngoAdminUserId1
      });
    }


    // ── 12. OTP REQUESTS ─────────────────────────────────────────────────

    console.log('🌱 Seeding OTP verification requests...');

    await OtpVerificationRequest.create({
      otpRequestId:           id(),
      targetPhoneNumber:      '+254711000099',
      hashedOtpCode:          await hash('482910'),
      otpExpirationTimestamp: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
      otpVerificationStatus:  'PENDING'
    });
    await OtpVerificationRequest.create({
      otpRequestId:           id(),
      targetPhoneNumber:      '+254711000001',
      hashedOtpCode:          await hash('193847'),
      otpExpirationTimestamp: new Date(Date.now() - 60000), // already expired
      otpVerificationStatus:  'VERIFIED'
    });


    // ── 13. USSD CALLBACK REQUESTS ───────────────────────────────────────

    console.log('🌱 Seeding USSD callback requests...');

    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000001', callbackFulfillmentStatus: 'PENDING'   });
    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000002', callbackFulfillmentStatus: 'COMPLETED' });
    await UssdCallbackRequest.create({ callbackRequestId: id(), requesterPhoneNumber: '+254722000003', callbackFulfillmentStatus: 'PENDING'   });


    // ── 14. AUDIT LOG ENTRIES ────────────────────────────────────────────

    console.log('🌱 Seeding audit log entries...');

    await AuditLog.create({ auditId: id(), actorUserId: survivorUserIds[0], actionType: 'LOGIN',               targetEntity: null             });
    await AuditLog.create({ auditId: id(), actorUserId: survivorUserIds[0], actionType: 'REPORT_SUBMITTED',    targetEntity: 'incidentReport' });
    await AuditLog.create({ auditId: id(), actorUserId: ngoAdminUserId1,    actionType: 'COMMUNITY_ROOM_CREATED', targetEntity: 'communityRoom' });
    await AuditLog.create({ auditId: id(), actorUserId: ngoAdminUserId1,    actionType: 'STAFF_ACCOUNT_CREATED', targetEntity: 'userAccount'   });


    console.log('\n✅ Database seeded successfully.');
    console.log('─────────────────────────────────────────');
    console.log('  Moderators:            1');
    console.log('  NGO Admins:            2');
    console.log('  Counsellors:           3');
    console.log('  Legal Counsel:         3');
    console.log('  Survivors:             5');
    console.log('  Reports:               24 (1 escalated to legal case)');
    console.log('  Community Rooms:       2');
    console.log('  Flagged Messages:      2');
    console.log('  Direct Chat Channels:  10 (2 per survivor: 1 counsellor + 1 legal)');
    console.log('    ↳ 1 archived  (Survivor[2] ↔ counsellor)  — Archive/Restore test');
    console.log('    ↳ 1 deleted   (Survivor[3] ↔ legal)       — Trash/Restore test');
    console.log('  Resources:             8');
    console.log('─────────────────────────────────────────');
    console.log('  Demo credentials (unchanged):');
    console.log('    Survivor:       +254711000001 / Survivor@2026!');
    console.log('    Counsellor:     +254700000020 / Counsellor@2026!');
    console.log('    Legal Counsel:  +254700000030 / LegalCounsel@2026!');
    console.log('    NGO Admin:      +254700000010 / NgoAdmin@2026!');
    console.log('    Moderator:      +254700000001 / Moderator@2026!');
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
