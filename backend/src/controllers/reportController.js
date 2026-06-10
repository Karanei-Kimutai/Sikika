const { Op, fn, col } = require("sequelize");
const { randomUUID } = require("crypto");
const {
  IncidentReport,
  EvidenceFile,
  LegalCaseFile,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  UserAccount,
  InAppNotification
} = require("../models");
const {
  isCloudinaryConfigured,
  uploadEvidenceBuffer,
  generateEvidenceSignedUrl
} = require("../config/cloudinary");

/**
 * reportController.js
 *
 * Core reporting workflow:
 * - Survivors create and manage their own submissions.
 * - Assigned staff (counsellor/legal) and NGO admins can review and advance status.
 * - Status changes are guarded by both transition rules and role permissions.
 * - Evidence files are stored in Cloudinary; clients receive short-lived signed URLs.
 */

const EMERGENCY_CONTACTS = [
  "Police emergency: 999 / 112",
  "Childline Kenya: 116",
  "National GBV Hotline: 1195"
];

const REPORT_STATUS = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACTIVE_SUPPORT: "ACTIVE_SUPPORT",
  UNDER_INVESTIGATION: "UNDER_INVESTIGATION",
  LEGAL_REVIEW: "LEGAL_REVIEW",
  ESCALATED_TO_LEGAL_CASE: "ESCALATED_TO_LEGAL_CASE",
  RESOLVED: "RESOLVED",
  WITHDRAWN: "WITHDRAWN"
};

const STATUS_TRANSITIONS = {
  [REPORT_STATUS.SUBMITTED]: [REPORT_STATUS.UNDER_REVIEW, REPORT_STATUS.WITHDRAWN],
  [REPORT_STATUS.UNDER_REVIEW]: [REPORT_STATUS.ACTIVE_SUPPORT, REPORT_STATUS.UNDER_INVESTIGATION, REPORT_STATUS.WITHDRAWN],
  [REPORT_STATUS.ACTIVE_SUPPORT]: [REPORT_STATUS.UNDER_INVESTIGATION, REPORT_STATUS.LEGAL_REVIEW, REPORT_STATUS.RESOLVED, REPORT_STATUS.WITHDRAWN],
  [REPORT_STATUS.UNDER_INVESTIGATION]: [REPORT_STATUS.LEGAL_REVIEW, REPORT_STATUS.RESOLVED, REPORT_STATUS.WITHDRAWN],
  [REPORT_STATUS.LEGAL_REVIEW]: [REPORT_STATUS.ESCALATED_TO_LEGAL_CASE, REPORT_STATUS.ACTIVE_SUPPORT, REPORT_STATUS.RESOLVED, REPORT_STATUS.WITHDRAWN],
  [REPORT_STATUS.ESCALATED_TO_LEGAL_CASE]: [REPORT_STATUS.RESOLVED],
  IN_PROGRESS: [REPORT_STATUS.UNDER_INVESTIGATION, REPORT_STATUS.LEGAL_REVIEW, REPORT_STATUS.RESOLVED, REPORT_STATUS.WITHDRAWN],
  ESCALATED: [REPORT_STATUS.RESOLVED],
  [REPORT_STATUS.RESOLVED]: [],
  [REPORT_STATUS.WITHDRAWN]: []
};

// Allowed transitions are intentionally explicit so invalid workflow jumps are
// blocked at API level regardless of client behavior.

const STATUS_UPDATE_PERMISSIONS = {
  SURVIVOR: [],
  COUNSELLOR: [REPORT_STATUS.ACTIVE_SUPPORT, REPORT_STATUS.UNDER_INVESTIGATION, REPORT_STATUS.RESOLVED],
  LEGAL_COUNSEL: [REPORT_STATUS.LEGAL_REVIEW, REPORT_STATUS.ESCALATED_TO_LEGAL_CASE, REPORT_STATUS.RESOLVED],
  NGO_ADMIN: [REPORT_STATUS.UNDER_REVIEW, REPORT_STATUS.ACTIVE_SUPPORT, REPORT_STATUS.UNDER_INVESTIGATION, REPORT_STATUS.LEGAL_REVIEW, REPORT_STATUS.RESOLVED],
  SYSTEM_ADMIN: []
};

// Roles are allowed to set only specific next states, even when a transition
// itself is valid in STATUS_TRANSITIONS.

function normalizeRole(value) {
  if (!value) return "";

  const role = String(value).trim().toUpperCase();
  if (role === "LEGALCOUNSEL") return "LEGAL_COUNSEL";
  if (role === "NGOADMIN") return "NGO_ADMIN";
  if (role === "SYSTEMADMIN") return "SYSTEM_ADMIN";
  return role.replace(/\s+/g, "_");
}

function normalizeSeverity(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");

  if (normalized === "PENDING_REVIEW") return REPORT_STATUS.UNDER_REVIEW;
  if (normalized === "IN_PROGRESS") return REPORT_STATUS.ACTIVE_SUPPORT;
  if (normalized === "ESCALATED") return REPORT_STATUS.ESCALATED_TO_LEGAL_CASE;

  return normalized;
}

function getEvidenceTypeFromMime(mime) {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

function getEmergencyContactsResponse() {
  return {
    error: "Reporting is only available for registered and authenticated survivors.",
    redirectTo: "/emergency-contacts",
    emergencyContacts: EMERGENCY_CONTACTS
  };
}

function toApiEvidence(evidence) {
  return {
    evidenceId: evidence.evidenceFileId,
    reportId: evidence.reportId,
    fileType: evidence.evidenceFileType,
    cloudinaryPublicId: evidence.cloudinaryPublicIdentifier,
    signedUrl: evidence.dynamicallySignedUrl,
    uploadTimestamp: evidence.fileUploadTimestamp,
    originalFileName: evidence.originalFileName
  };
}

function toApiLegalCase(legalCase) {
  if (!legalCase) return null;

  return {
    legalCaseId: legalCase.legalCaseId,
    reportId: legalCase.reportId,
    escalationDate: legalCase.escalationTimestamp,
    caseStatus: legalCase.currentCaseStatus,
    generatedDocumentPath: legalCase.generatedDocumentPath
  };
}

function toApiReport(report) {
  return {
    reportId: report.reportId,
    survivorId: report.survivorId,
    category: report.incidentCategory,
    severityLevel: report.severityLevel,
    description: report.incidentDescriptionText,
    location: report.incidentLocation,
    date: report.incidentDate,
    reportStatus: report.currentReportStatus,
    createdAt: report.reportCreationTimestamp,
    evidence: (report.evidenceFiles || []).map(toApiEvidence),
    legalCase: toApiLegalCase(report.legalCaseFile)
  };
}

async function createNotification(recipientUserId, message, category = "REPORT_UPDATE") {
  await InAppNotification.create({
    notificationId: randomUUID(),
    recipientUserId,
    notificationCategoryType: category,
    discreetNotificationMessage: message,
    notificationReadStatus: "UNREAD"
  });
}

async function getReportStakeholderUserIds(survivorId) {
  const recipientUserIds = new Set();
  const survivor = await SurvivorProfile.findByPk(survivorId);

  if (survivor?.userId) {
    recipientUserIds.add(survivor.userId);
  }

  if (survivor?.assignedCounsellorId) {
    const assignedCounsellor = await CounsellorProfile.findByPk(survivor.assignedCounsellorId);
    if (assignedCounsellor?.userId) recipientUserIds.add(assignedCounsellor.userId);
  }

  if (survivor?.assignedLegalCounselId) {
    const assignedLegalCounsel = await LegalCounselProfile.findByPk(survivor.assignedLegalCounselId);
    if (assignedLegalCounsel?.userId) recipientUserIds.add(assignedLegalCounsel.userId);
  }

  const ngoAdmins = await NgoAdministratorProfile.findAll({ attributes: ["userId"] });
  ngoAdmins.forEach((profile) => recipientUserIds.add(profile.userId));

  return recipientUserIds;
}

async function notifyStakeholders({
  survivorId,
  actorUserId,
  survivorMessage,
  staffMessage,
  category = "REPORT_UPDATE"
}) {
  const stakeholderIds = await getReportStakeholderUserIds(survivorId);

  if (survivorMessage) {
    const survivor = await SurvivorProfile.findByPk(survivorId, { attributes: ["userId"] });
    if (survivor?.userId) {
      await createNotification(survivor.userId, survivorMessage, category);
    }
  }

  if (!staffMessage) return;

  const survivor = await SurvivorProfile.findByPk(survivorId, { attributes: ["userId"] });
  if (survivor?.userId) {
    stakeholderIds.delete(survivor.userId);
  }

  if (actorUserId) {
    stakeholderIds.delete(actorUserId);
  }

  // Fan-out runs in parallel to avoid serial notification delays on write paths.
  await Promise.all(
    [...stakeholderIds].map((recipientUserId) => createNotification(recipientUserId, staffMessage, category))
  );
}

async function getActorContext(req) {
  if (!req.user?.id) {
    return null;
  }

  const account = await UserAccount.findByPk(req.user.id);
  if (!account) {
    return null;
  }

  const role = normalizeRole(req.user.role || req.user.userRole || account.userRole || account.role);

  const context = {
    userId: account.userId,
    role,
    survivorId: null,
    counsellorId: null,
    legalCounselId: null
  };

  if (role === "SURVIVOR") {
    const survivor = await SurvivorProfile.findOne({ where: { userId: account.userId } });
    context.survivorId = survivor?.survivorId || null;
  } else if (role === "COUNSELLOR") {
    const counsellor = await CounsellorProfile.findOne({ where: { userId: account.userId } });
    context.counsellorId = counsellor?.counsellorId || null;
  } else if (role === "LEGAL_COUNSEL") {
    const legalCounsel = await LegalCounselProfile.findOne({ where: { userId: account.userId } });
    context.legalCounselId = legalCounsel?.legalCounselId || null;
  }

  return context;
}

async function canActorAccessReport(actor, report) {
  if (!actor || !report) return false;

  if (actor.role === "SYSTEM_ADMIN") {
    return false;
  }

  if (actor.role === "NGO_ADMIN") {
    return true;
  }

  if (actor.role === "SURVIVOR") {
    return actor.survivorId && actor.survivorId === report.survivorId;
  }

  if (actor.role === "COUNSELLOR") {
    if (!actor.counsellorId) return false;

    // Counsellors can only access reports for survivors currently assigned to
    // their counsellor profile.
    const survivor = await SurvivorProfile.findOne({
      where: {
        survivorId: report.survivorId,
        assignedCounsellorId: actor.counsellorId
      }
    });

    return Boolean(survivor);
  }

  if (actor.role === "LEGAL_COUNSEL") {
    if (!actor.legalCounselId) return false;

    // Legal counsel access follows legal assignment links only.
    const survivor = await SurvivorProfile.findOne({
      where: {
        survivorId: report.survivorId,
        assignedLegalCounselId: actor.legalCounselId
      }
    });

    return Boolean(survivor);
  }

  return false;
}

async function fetchReportById(reportId) {
  return IncidentReport.findByPk(reportId, {
    include: [
      {
        model: EvidenceFile,
        attributes: [
          "evidenceFileId",
          "reportId",
          "evidenceFileType",
          "cloudinaryPublicIdentifier",
          "dynamicallySignedUrl",
          "fileUploadTimestamp",
          "originalFileName"
        ]
      },
      {
        model: LegalCaseFile,
        attributes: [
          "legalCaseId",
          "reportId",
          "escalationTimestamp",
          "currentCaseStatus",
          "generatedDocumentPath"
        ]
      }
    ]
  });
}

async function attachFreshEvidenceUrls(report) {
  if (!isCloudinaryConfigured()) {
    return report;
  }

  await Promise.all((report.evidenceFiles || []).map(async (evidence) => {
    const signedUrl = generateEvidenceSignedUrl({
      publicId: evidence.cloudinaryPublicIdentifier,
      evidenceType: evidence.evidenceFileType
    });

    evidence.dynamicallySignedUrl = signedUrl;
    await evidence.save();
  }));

  return report;
}

async function ensureLegalCaseForWorkflow({ report, nextStatus, generatedDocumentPath }) {
  if (nextStatus !== REPORT_STATUS.LEGAL_REVIEW && nextStatus !== REPORT_STATUS.ESCALATED_TO_LEGAL_CASE) {
    return null;
  }

  const [legalCase] = await LegalCaseFile.findOrCreate({
    where: { reportId: report.reportId },
    defaults: {
      legalCaseId: randomUUID(),
      reportId: report.reportId,
      escalationTimestamp: new Date(),
      currentCaseStatus: nextStatus === REPORT_STATUS.LEGAL_REVIEW ? "UNDER_INVESTIGATION" : "READY_FOR_SUBMISSION",
      generatedDocumentPath: generatedDocumentPath || null
    }
  });

  if (nextStatus === REPORT_STATUS.LEGAL_REVIEW && legalCase.currentCaseStatus === "OPEN") {
    legalCase.currentCaseStatus = "UNDER_INVESTIGATION";
    await legalCase.save();
  }

  if (nextStatus === REPORT_STATUS.ESCALATED_TO_LEGAL_CASE) {
    legalCase.currentCaseStatus = "READY_FOR_SUBMISSION";
    legalCase.escalationTimestamp = new Date();
    if (generatedDocumentPath) {
      legalCase.generatedDocumentPath = generatedDocumentPath;
    }
    await legalCase.save();
  }

  return legalCase;
}

async function createReport(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json(getEmergencyContactsResponse());
  }

  if (actor.role !== "SURVIVOR") {
    return res.status(403).json({ error: "Only survivors can submit reports." });
  }

  if (!actor.survivorId) {
    return res.status(403).json({ error: "Survivor profile not found for this account." });
  }

  const category = String(req.body.category || req.body.incidentCategory || "").trim();
  const description = String(req.body.description || req.body.incidentDescriptionText || "").trim();
  const location = String(req.body.location || req.body.incidentLocation || "").trim();
  const incidentDate = req.body.date || req.body.incidentDate || null;
  const severity = normalizeSeverity(req.body.severityLevel);

  if (!category || !description || !severity) {
    return res.status(400).json({
      error: "category, severityLevel, and description are required."
    });
  }

  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
    return res.status(400).json({
      error: "severityLevel must be one of LOW, MEDIUM, HIGH, CRITICAL."
    });
  }

  const report = await IncidentReport.create({
    reportId: randomUUID(),
    survivorId: actor.survivorId,
    incidentCategory: category,
    severityLevel: severity,
    incidentDescriptionText: description,
    incidentLocation: location || null,
    incidentDate,
    currentReportStatus: REPORT_STATUS.SUBMITTED
  });

  await notifyStakeholders({
    survivorId: actor.survivorId,
    actorUserId: actor.userId,
    staffMessage: "A new submission requires attention",
    category: "NEW_SUBMISSION"
  });

  return res.status(201).json({ report: toApiReport(report) });
}

async function listReports(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role === "SYSTEM_ADMIN") {
    return res.status(403).json({ error: "System administrators do not have access to survivor reports." });
  }

  const where = {};

  if (req.query.status) {
    where.currentReportStatus = normalizeStatus(req.query.status);
  }

  if (req.query.category) {
    where.incidentCategory = String(req.query.category).trim();
  }

  if (req.query.severityLevel) {
    where.severityLevel = normalizeSeverity(req.query.severityLevel);
  }

  if (actor.role === "SURVIVOR") {
    // Survivors only see their own submissions.
    where.survivorId = actor.survivorId;
  }

  if (actor.role === "COUNSELLOR") {
    const survivors = await SurvivorProfile.findAll({
      attributes: ["survivorId"],
      where: { assignedCounsellorId: actor.counsellorId }
    });
    const survivorIds = survivors.map((survivor) => survivor.survivorId);
    // Force empty result when no assignments exist instead of widening scope.
    where.survivorId = survivorIds.length > 0 ? { [Op.in]: survivorIds } : "__none__";
  }

  if (actor.role === "LEGAL_COUNSEL") {
    const survivors = await SurvivorProfile.findAll({
      attributes: ["survivorId"],
      where: { assignedLegalCounselId: actor.legalCounselId }
    });
    const survivorIds = survivors.map((survivor) => survivor.survivorId);
    // Force empty result when no assignments exist instead of widening scope.
    where.survivorId = survivorIds.length > 0 ? { [Op.in]: survivorIds } : "__none__";
  }

  const reports = await IncidentReport.findAll({
    where,
    order: [["reportCreationTimestamp", "DESC"]],
    include: [
      { model: EvidenceFile },
      { model: LegalCaseFile }
    ]
  });

  return res.json({ reports: reports.map(toApiReport) });
}

async function getReport(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role === "SYSTEM_ADMIN") {
    return res.status(403).json({ error: "System administrators do not have access to survivor reports." });
  }

  const report = await fetchReportById(req.params.reportId);

  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  const allowed = await canActorAccessReport(actor, report);
  if (!allowed) {
    return res.status(403).json({ error: "You do not have access to this report." });
  }

  await attachFreshEvidenceUrls(report);

  return res.json({ report: toApiReport(report) });
}

async function updateOwnReport(req, res) {
  const actor = await getActorContext(req);

  if (!actor || actor.role !== "SURVIVOR") {
    return res.status(403).json({ error: "Only survivors can edit report content." });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  if (report.survivorId !== actor.survivorId) {
    return res.status(403).json({ error: "You can only edit your own reports." });
  }

  if (report.currentReportStatus !== REPORT_STATUS.SUBMITTED) {
    return res.status(409).json({
      error: "This report can no longer be edited once review has started."
    });
  }

  const category = req.body.category || req.body.incidentCategory;
  const severity = req.body.severityLevel ? normalizeSeverity(req.body.severityLevel) : null;

  if (severity && !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
    return res.status(400).json({
      error: "severityLevel must be one of LOW, MEDIUM, HIGH, CRITICAL."
    });
  }

  if (category) report.incidentCategory = String(category).trim();
  if (severity) report.severityLevel = severity;
  if (req.body.description || req.body.incidentDescriptionText) {
    report.incidentDescriptionText = String(req.body.description || req.body.incidentDescriptionText).trim();
  }
  if (req.body.location || req.body.incidentLocation) {
    report.incidentLocation = String(req.body.location || req.body.incidentLocation).trim();
  }
  if (req.body.date || req.body.incidentDate) {
    report.incidentDate = req.body.date || req.body.incidentDate;
  }

  await report.save();

  await notifyStakeholders({
    survivorId: report.survivorId,
    actorUserId: actor.userId,
    staffMessage: "A request has been updated",
    category: "REPORT_UPDATE"
  });

  return res.json({ report: toApiReport(report) });
}

async function withdrawReport(req, res) {
  const actor = await getActorContext(req);

  if (!actor || actor.role !== "SURVIVOR") {
    return res.status(403).json({ error: "Only survivors can withdraw reports." });
  }

  if (req.body.confirmWithdraw !== true) {
    return res.status(400).json({
      error: "Please confirm withdrawal before continuing.",
      warning: "Withdrawing may delay support. If you are in immediate danger, use emergency contacts."
    });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  if (report.survivorId !== actor.survivorId) {
    return res.status(403).json({ error: "You can only withdraw your own reports." });
  }

  report.currentReportStatus = REPORT_STATUS.WITHDRAWN;
  await report.save();

  await notifyStakeholders({
    survivorId: report.survivorId,
    actorUserId: actor.userId,
    staffMessage: "A request has been updated",
    category: "REPORT_UPDATE"
  });

  return res.json({
    message: "Report withdrawn successfully.",
    report: toApiReport(report)
  });
}

async function deleteOwnReport(req, res) {
  const actor = await getActorContext(req);

  if (!actor || actor.role !== "SURVIVOR") {
    return res.status(403).json({ error: "Only survivors can delete reports." });
  }

  if (req.body.confirmWithdraw !== true) {
    return res.status(400).json({
      error: "Please confirm deletion before continuing.",
      warning: "Deleting this report can suppress evidence. Consider withdrawing instead."
    });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  if (report.survivorId !== actor.survivorId) {
    return res.status(403).json({ error: "You can only delete your own reports." });
  }

  await report.destroy();

  await notifyStakeholders({
    survivorId: report.survivorId,
    actorUserId: actor.userId,
    staffMessage: "A request has been withdrawn",
    category: "REPORT_UPDATE"
  });

  return res.json({ message: "Report deleted successfully." });
}

async function updateReportStatus(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (!["COUNSELLOR", "LEGAL_COUNSEL", "NGO_ADMIN"].includes(actor.role)) {
    return res.status(403).json({ error: "Only support staff can update report status." });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  const canView = await canActorAccessReport(actor, report);
  if (!canView) {
    return res.status(403).json({ error: "You do not have access to this report." });
  }

  const nextStatus = normalizeStatus(req.body.reportStatus || req.body.currentReportStatus);
  if (!nextStatus || !REPORT_STATUS[nextStatus]) {
    return res.status(400).json({ error: "Invalid target report status." });
  }

  const currentStatus = report.currentReportStatus;
  const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [];

  if (!allowedTransitions.includes(nextStatus)) {
    return res.status(409).json({
      error: `Invalid status transition from ${currentStatus} to ${nextStatus}.`
    });
  }

  // Role authorization is checked separately from transition validity.
  if (!STATUS_UPDATE_PERMISSIONS[actor.role].includes(nextStatus)) {
    return res.status(403).json({
      error: `Role ${actor.role} is not allowed to set status ${nextStatus}.`
    });
  }

  if (nextStatus === REPORT_STATUS.ESCALATED_TO_LEGAL_CASE) {
    // Escalation to legal case has extra safeguards beyond generic transitions.
    if (actor.role !== "LEGAL_COUNSEL") {
      return res.status(403).json({
        error: "Only legal counsel can escalate to a legal case."
      });
    }

    if (req.body.survivorConsent !== true) {
      return res.status(400).json({
        error: "survivorConsent must be true before legal escalation."
      });
    }

    await ensureLegalCaseForWorkflow({
      report,
      nextStatus,
      generatedDocumentPath: req.body.generatedDocumentPath || null
    });
  }

  if (nextStatus === REPORT_STATUS.LEGAL_REVIEW) {
    // Legal review requires a linked legal-case record even before escalation.
    await ensureLegalCaseForWorkflow({
      report,
      nextStatus,
      generatedDocumentPath: req.body.generatedDocumentPath || null
    });
  }

  report.currentReportStatus = nextStatus;
  await report.save();

  if (nextStatus === REPORT_STATUS.RESOLVED) {
    // Resolution closes the legal case when one exists, keeping workflow state
    // synchronized between report and case artifacts.
    const legalCase = await LegalCaseFile.findOne({ where: { reportId: report.reportId } });
    if (legalCase && legalCase.currentCaseStatus !== "CLOSED") {
      legalCase.currentCaseStatus = "CLOSED";
      await legalCase.save();
    }
  }

  await notifyStakeholders({
    survivorId: report.survivorId,
    actorUserId: actor.userId,
    survivorMessage: "Your request has been updated",
    staffMessage: "A request status has been updated",
    category: "REPORT_UPDATE"
  });

  const refreshed = await fetchReportById(report.reportId);
  return res.json({ report: toApiReport(refreshed) });
}

async function uploadEvidence(req, res) {
  const actor = await getActorContext(req);

  if (!actor || actor.role !== "SURVIVOR") {
    return res.status(403).json({ error: "Only survivors can upload report evidence." });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  if (report.survivorId !== actor.survivorId) {
    return res.status(403).json({ error: "You can only upload evidence to your own reports." });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No evidence file was uploaded." });
  }

  const evidenceFileType = getEvidenceTypeFromMime(req.file.mimetype);
  if (!evidenceFileType) {
    return res.status(400).json({ error: "Unsupported evidence file type. Allowed: images, PDF, audio." });
  }

  if (!isCloudinaryConfigured()) {
    return res.status(503).json({
      error: "Evidence uploads are unavailable because Cloudinary is not configured."
    });
  }

  // Upload once to cloud storage and persist only metadata + signed access URL.
  const uploadResult = await uploadEvidenceBuffer({
    buffer: req.file.buffer,
    reportId: report.reportId,
    mimeType: req.file.mimetype
  });

  const signedUrl = generateEvidenceSignedUrl({
    publicId: uploadResult.public_id,
    evidenceType: evidenceFileType
  });

  const evidence = await EvidenceFile.create({
    evidenceFileId: randomUUID(),
    reportId: report.reportId,
    evidenceFileType,
    originalFileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    cloudinaryPublicIdentifier: uploadResult.public_id,
    dynamicallySignedUrl: signedUrl,
    fileUploadTimestamp: new Date()
  });

  await notifyStakeholders({
    survivorId: report.survivorId,
    actorUserId: actor.userId,
    staffMessage: "New files were added to a request",
    category: "REPORT_UPDATE"
  });

  return res.status(201).json({ evidence: toApiEvidence(evidence) });
}

async function getReportAnalytics(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN") {
    return res.status(403).json({ error: "Only NGO administrators can access reporting analytics." });
  }

  const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
  const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

  const where = {};
  if (startDate && !Number.isNaN(startDate.getTime())) {
    where.reportCreationTimestamp = { ...(where.reportCreationTimestamp || {}), [Op.gte]: startDate };
  }
  if (endDate && !Number.isNaN(endDate.getTime())) {
    where.reportCreationTimestamp = { ...(where.reportCreationTimestamp || {}), [Op.lte]: endDate };
  }

  const [
    totalReports,
    openReports,
    resolvedReports,
    withdrawnReports,
    byStatus,
    byCategory,
    bySeverity,
    byCreationDate,
    legalCasesByStatus,
    reportsWithCounty
  ] = await Promise.all([
    IncidentReport.count({ where }),
    IncidentReport.count({
      where: {
        ...where,
        currentReportStatus: {
          [Op.notIn]: [REPORT_STATUS.RESOLVED, REPORT_STATUS.WITHDRAWN]
        }
      }
    }),
    IncidentReport.count({ where: { ...where, currentReportStatus: REPORT_STATUS.RESOLVED } }),
    IncidentReport.count({ where: { ...where, currentReportStatus: REPORT_STATUS.WITHDRAWN } }),
    IncidentReport.findAll({
      where,
      attributes: [
        "currentReportStatus",
        [fn("COUNT", col("reportId")), "count"]
      ],
      group: ["currentReportStatus"],
      raw: true
    }),
    IncidentReport.findAll({
      where,
      attributes: [
        "incidentCategory",
        [fn("COUNT", col("reportId")), "count"]
      ],
      group: ["incidentCategory"],
      raw: true
    }),
    IncidentReport.findAll({
      where,
      attributes: [
        "severityLevel",
        [fn("COUNT", col("reportId")), "count"]
      ],
      group: ["severityLevel"],
      raw: true
    }),
    IncidentReport.findAll({
      where,
      attributes: [
        "incidentDate",
        [fn("COUNT", col("reportId")), "count"]
      ],
      group: ["incidentDate"],
      order: [["incidentDate", "ASC"]],
      raw: true
    }),
    LegalCaseFile.findAll({
      attributes: [
        "currentCaseStatus",
        [fn("COUNT", col("legalCaseId")), "count"]
      ],
      group: ["currentCaseStatus"],
      raw: true
    }),
    IncidentReport.findAll({
      where,
      attributes: ["reportId"],
      include: [{ model: SurvivorProfile, attributes: ["residenceCounty"] }]
    })
  ]);

  const byCountyMap = reportsWithCounty.reduce((acc, report) => {
    const county = report.survivorProfile?.residenceCounty || "UNSPECIFIED";
    acc[county] = (acc[county] || 0) + 1;
    return acc;
  }, {});

  const byCounty = Object.entries(byCountyMap)
    .map(([county, count]) => ({ county, count }))
    .sort((a, b) => b.count - a.count);

  return res.json({
    summary: {
      totalReports,
      openReports,
      resolvedReports,
      withdrawnReports
    },
    byStatus: byStatus.map((row) => ({ status: row.currentReportStatus, count: Number(row.count) })),
    byCategory: byCategory.map((row) => ({ category: row.incidentCategory, count: Number(row.count) })),
    bySeverity: bySeverity.map((row) => ({ severityLevel: row.severityLevel, count: Number(row.count) })),
    byCounty,
    trendByIncidentDate: byCreationDate.map((row) => ({ date: row.incidentDate, count: Number(row.count) })),
    legalCasesByStatus: legalCasesByStatus.map((row) => ({ caseStatus: row.currentCaseStatus, count: Number(row.count) }))
  });
}

async function getEvidenceAccessUrl(req, res) {
  const actor = await getActorContext(req);

  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role === "SYSTEM_ADMIN") {
    return res.status(403).json({ error: "System administrators do not have access to survivor evidence." });
  }

  const report = await IncidentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  const canView = await canActorAccessReport(actor, report);
  if (!canView) {
    return res.status(403).json({ error: "You do not have access to this report evidence." });
  }

  const evidence = await EvidenceFile.findOne({
    where: {
      reportId: req.params.reportId,
      evidenceFileId: req.params.evidenceId
    }
  });

  if (!evidence) {
    return res.status(404).json({ error: "Evidence file not found." });
  }

  if (!isCloudinaryConfigured()) {
    return res.status(503).json({
      error: "Evidence access URLs are unavailable because Cloudinary is not configured."
    });
  }

  // URL is refreshed on access to keep evidence links short-lived and revocable.
  evidence.dynamicallySignedUrl = generateEvidenceSignedUrl({
    publicId: evidence.cloudinaryPublicIdentifier,
    evidenceType: evidence.evidenceFileType
  });
  await evidence.save();

  return res.json({
    evidenceId: evidence.evidenceFileId,
    signedUrl: evidence.dynamicallySignedUrl,
    expiresInSeconds: 300
  });
}

module.exports = {
  createReport,
  listReports,
  getReport,
  updateOwnReport,
  withdrawReport,
  deleteOwnReport,
  updateReportStatus,
  getReportAnalytics,
  uploadEvidence,
  getEvidenceAccessUrl
};
