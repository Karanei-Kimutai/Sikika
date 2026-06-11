const { Op, fn, col, literal } = require('sequelize');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const {
  sequelize,
  UserAccount,
  IncidentReport,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  HarmfulContentReport,
  CommunityMessage,
  CommunityRoom,
  RoomMembership,
  LegalCaseFile,
  SystemAdministratorProfile,
  NgoAdministratorProfile,
  AuditLog,
  SupportResource,
  StaffAssignmentHistory,
  ResourceAccessEvent
} = require('../models');

/**
 * Admin Controller
 * ----------------
 * Centralized controller for NGO and system administration features.
 *
 * Responsibilities covered here:
 * - NGO operations dashboard aggregates
 * - staff reassignment and workload recalculation
 * - NGO resource create/update and resource analytics
 * - system dashboard telemetry
 * - maintenance mode state management + enforcement helpers
 * - runtime actions (clear cache / restart request)
 * - system audit log streaming
 * - staff onboarding and staff account lifecycle status updates
 */

// In-memory maintenance/runtime state (process-local, resets on server restart).
let maintenanceModeEnabled = false;
let maintenanceUpdatedAt = null;
let maintenanceReason = null;
let maintenanceExpectedUntil = null;
let lastCacheClearAt = null;
let lastRestartRequestAt = null;

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'LEGALCOUNSEL') return 'LEGAL_COUNSEL';
  if (role === 'NGOADMIN') return 'NGO_ADMIN';
  if (role === 'SYSTEMADMIN') return 'SYSTEM_ADMIN';
  return role;
}

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

function compatibilityRoleForUserRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'LEGAL_COUNSEL') return 'legal_counsel';
  if (normalized === 'NGO_ADMIN') return 'ngo_admin';
  if (normalized === 'SYSTEM_ADMIN') return 'system_admin';
  if (normalized === 'COUNSELLOR') return 'counsellor';
  return 'survivor';
}

function getRoleFromAuthHeader(req) {
  const header = req.headers?.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.slice('Bearer '.length).trim(), process.env.JWT_SECRET);
    return normalizeRole(decoded.role || decoded.userRole);
  } catch {
    return null;
  }
}

async function getActor(req) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId, {
    attributes: ['userId', 'userRole', 'accountStatus']
  });

  if (!user || user.accountStatus !== 'ACTIVE') return null;

  return {
    userId: user.userId,
    role: normalizeRole(user.userRole)
  };
}

function roleForbidden(res, allowedRoles) {
  return res.status(403).json({
    error: 'Insufficient permissions for this admin endpoint.',
    allowedRoles
  });
}

function formatDateKey(value) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildLast30DaySeries(rows) {
  const countByDate = new Map(
    rows.map((row) => [formatDateKey(row.date), Number(row.count || 0)])
  );
  const today = new Date();
  const output = [];

  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = formatDateKey(date);
    output.push({ date: key, count: countByDate.get(key) || 0 });
  }

  return output;
}

function roleDisplay(role) {
  if (role === 'COUNSELLOR') return 'Counsellor';
  if (role === 'LEGAL_COUNSEL') return 'Legal Counsel';
  return 'Staff';
}

function shortCode(value) {
  return String(value || '').replace(/-/g, '').slice(0, 6).toUpperCase();
}

async function refreshWorkloadScores() {
  // Recompute staff workload from live survivor assignments after reassignments.
  const [counsellors, legalCounsel] = await Promise.all([
    CounsellorProfile.findAll({ attributes: ['counsellorId'] }),
    LegalCounselProfile.findAll({ attributes: ['legalCounselId'] })
  ]);

  const [counsellorAssignments, legalAssignments] = await Promise.all([
    SurvivorProfile.findAll({
      attributes: ['assignedCounsellorId', [fn('COUNT', col('survivorId')), 'count']],
      where: { assignedCounsellorId: { [Op.not]: null } },
      group: ['assignedCounsellorId'],
      raw: true
    }),
    SurvivorProfile.findAll({
      attributes: ['assignedLegalCounselId', [fn('COUNT', col('survivorId')), 'count']],
      where: { assignedLegalCounselId: { [Op.not]: null } },
      group: ['assignedLegalCounselId'],
      raw: true
    })
  ]);

  const counsellorCountMap = new Map(
    counsellorAssignments.map((row) => [row.assignedCounsellorId, Number(row.count || 0)])
  );
  const legalCountMap = new Map(
    legalAssignments.map((row) => [row.assignedLegalCounselId, Number(row.count || 0)])
  );

  await Promise.all([
    ...counsellors.map((profile) => profile.update({ currentWorkloadScore: counsellorCountMap.get(profile.counsellorId) || 0 })),
    ...legalCounsel.map((profile) => profile.update({ currentWorkloadScore: legalCountMap.get(profile.legalCounselId) || 0 }))
  ]);
}

/**
 * getNgoDashboard
 * ---------------
 * Returns the consolidated NGO operations payload used by the NGO admin frontend.
 * This intentionally centralizes multi-entity reads so cards/tables are time-aligned.
 */
async function getNgoDashboard(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalReports,
      monthReports,
      previousMonthReports,
      activeLegalCases,
      activeSurvivors,
      responseRows,
      reportsOverTimeRows,
      counsellorWorkload,
      legalWorkload,
      urgentCases,
      moderationQueue,
      urgentNotifications,
      ngoAdminProfile,
      communityMessages,
      communityRooms,
      recentReports,
      postedResources,
      survivorProfiles,
      reportsByCategoryRows,
      reportsByStatusRows,
      reportsByCountyRows,
      totalCommunityMessages,
      harmfulContentReportCount,
      survivorsWithAssignments,
      topResourceAccessRows,
      resourceUsageByCategoryRows
    ] = await Promise.all([
      IncidentReport.count(),
      IncidentReport.count({ where: { reportCreationTimestamp: { [Op.gte]: monthStart } } }),
      IncidentReport.count({
        where: {
          reportCreationTimestamp: {
            [Op.gte]: previousMonthStart,
            [Op.lt]: monthStart
          }
        }
      }),
      LegalCaseFile.count({ where: { currentCaseStatus: { [Op.not]: 'CLOSED' } } }),
      SurvivorProfile.count({
        where: {
          [Op.or]: [
            { assignedCounsellorId: { [Op.not]: null } },
            { assignedLegalCounselId: { [Op.not]: null } }
          ]
        }
      }),
      IncidentReport.findAll({
        attributes: [
          [literal('TIMESTAMPDIFF(MINUTE, reportCreationTimestamp, NOW())'), 'responseMinutes']
        ],
        where: {
          currentReportStatus: { [Op.notIn]: ['SUBMITTED', 'WITHDRAWN'] }
        },
        raw: true
      }),
      IncidentReport.findAll({
        attributes: [
          [fn('DATE', col('reportCreationTimestamp')), 'date'],
          [fn('COUNT', col('reportId')), 'count']
        ],
        where: { reportCreationTimestamp: { [Op.gte]: thirtyDaysAgo } },
        group: [fn('DATE', col('reportCreationTimestamp'))],
        order: [[fn('DATE', col('reportCreationTimestamp')), 'ASC']],
        raw: true
      }),
      CounsellorProfile.findAll({
        attributes: ['counsellorId', 'professionalSpecialization', 'currentWorkloadScore', 'availabilityStatus'],
        include: [{ model: UserAccount, attributes: ['userId', 'phoneNumber'] }],
        order: [['currentWorkloadScore', 'DESC']]
      }),
      LegalCounselProfile.findAll({
        attributes: ['legalCounselId', 'professionalSpecialization', 'currentWorkloadScore', 'availabilityStatus'],
        include: [{ model: UserAccount, attributes: ['userId', 'phoneNumber'] }],
        order: [['currentWorkloadScore', 'DESC']]
      }),
      IncidentReport.findAll({
        attributes: ['reportId', 'reportCreationTimestamp', 'severityLevel', 'currentReportStatus', 'survivorId'],
        where: {
          severityLevel: { [Op.in]: ['HIGH', 'CRITICAL'] },
          currentReportStatus: { [Op.notIn]: ['RESOLVED', 'WITHDRAWN'] }
        },
        order: [['reportCreationTimestamp', 'DESC']],
        limit: 10,
        raw: true
      }),
      HarmfulContentReport.findAll({
        attributes: ['contentReportId', 'reportSubmissionTimestamp', 'reportReasonText', 'moderationReviewStatus'],
        where: { moderationReviewStatus: 'PENDING' },
        include: [{
          model: CommunityMessage,
          as: 'reportedMessage',
          attributes: ['publicMessageContent'],
          include: [{ model: CommunityRoom, attributes: ['roomName'] }]
        }],
        order: [['reportSubmissionTimestamp', 'DESC']],
        limit: 12
      }),
      IncidentReport.findAll({
        attributes: ['reportId', 'severityLevel', 'currentReportStatus', 'reportCreationTimestamp'],
        where: {
          severityLevel: { [Op.in]: ['HIGH', 'CRITICAL'] },
          currentReportStatus: { [Op.in]: ['SUBMITTED', 'UNDER_REVIEW'] }
        },
        order: [['reportCreationTimestamp', 'DESC']],
        limit: 5,
        raw: true
      }),
      NgoAdministratorProfile.findOne({
        where: { userId: actor.userId },
        attributes: ['ngoAdminId', 'administrativeDepartment', 'administratorAccessLevel']
      }),
      CommunityMessage.findAll({
        attributes: ['communityMessageId', 'publicMessageContent', 'messageDispatchTimestamp', 'senderUserId', 'roomId'],
        include: [{ model: CommunityRoom, attributes: ['roomName'] }],
        order: [['messageDispatchTimestamp', 'DESC']],
        limit: 30
      }),
      CommunityRoom.findAll({
        attributes: ['roomId', 'roomName', 'roomCreationTimestamp'],
        order: [['roomCreationTimestamp', 'DESC']],
        limit: 12
      }),
      IncidentReport.findAll({
        attributes: ['reportId', 'incidentCategory', 'severityLevel', 'currentReportStatus', 'reportCreationTimestamp'],
        order: [['reportCreationTimestamp', 'DESC']],
        limit: 120,
        raw: true
      }),
      SupportResource.findAll({
        attributes: [
          'resourceId',
          'resourceTitle',
          'resourceDescription',
          'resourceCategory',
          'resourceFileUrl',
          'resourceUploadTimestamp',
          'uploadedByStaffId'
        ],
        include: [{
          model: UserAccount,
          as: 'uploadedBy',
          attributes: ['userId', 'phoneNumber', 'userRole']
        }],
        order: [['resourceUploadTimestamp', 'DESC']],
        limit: 30
      }),
      SurvivorProfile.findAll({
        attributes: ['userId', 'displayNickname'],
        raw: true
      }),
      IncidentReport.findAll({
        attributes: ['incidentCategory', [fn('COUNT', col('reportId')), 'count']],
        group: ['incidentCategory'],
        order: [[fn('COUNT', col('reportId')), 'DESC']],
        raw: true
      }),
      IncidentReport.findAll({
        attributes: ['currentReportStatus', [fn('COUNT', col('reportId')), 'count']],
        group: ['currentReportStatus'],
        order: [[fn('COUNT', col('reportId')), 'DESC']],
        raw: true
      }),
      IncidentReport.findAll({
        attributes: [
          [col('survivorProfile.residenceCounty'), 'county'],
          [fn('COUNT', col('reportId')), 'count']
        ],
        include: [{ model: SurvivorProfile, attributes: [] }],
        group: [col('survivorProfile.residenceCounty')],
        raw: true
      }),
      CommunityMessage.count(),
      HarmfulContentReport.count(),
      SurvivorProfile.findAll({
        attributes: ['survivorId', 'displayNickname', 'residenceCounty', 'assignedCounsellorId', 'assignedLegalCounselId'],
        order: [['displayNickname', 'ASC']],
        raw: true
      }),
      ResourceAccessEvent.findAll({
        attributes: ['resourceId', [fn('COUNT', col('accessEventId')), 'accessCount']],
        include: [{
          model: SupportResource,
          attributes: ['resourceTitle', 'resourceCategory']
        }],
        group: ['resourceId', 'supportResource.resourceId', 'supportResource.resourceTitle', 'supportResource.resourceCategory'],
        order: [[fn('COUNT', col('accessEventId')), 'DESC']],
        limit: 8
      }),
      ResourceAccessEvent.findAll({
        attributes: [[col('supportResource.resourceCategory'), 'category'], [fn('COUNT', col('resourceAccessEvent.accessEventId')), 'accessCount']],
        include: [{ model: SupportResource, attributes: [] }],
        group: [col('supportResource.resourceCategory')],
        order: [[fn('COUNT', col('resourceAccessEvent.accessEventId')), 'DESC']],
        raw: true
      })
    ]);

    const avgResponseMinutes = responseRows.length
      ? Math.round(
          responseRows.reduce((sum, row) => sum + Math.max(0, Number(row.responseMinutes || 0)), 0) /
            responseRows.length
        )
      : 0;

    const reportTrend = previousMonthReports > 0
      ? Number((((monthReports - previousMonthReports) / previousMonthReports) * 100).toFixed(1))
      : monthReports > 0
        ? 100
        : 0;

    const nicknameByUserId = new Map(
      survivorProfiles.map((profile) => [profile.userId, profile.displayNickname])
    );

    const roomIds = communityRooms.map((room) => room.roomId);
    const [roomMemberCounts, roomMessageCounts] = await Promise.all([
      RoomMembership.findAll({
        attributes: ['roomId', [fn('COUNT', col('membershipId')), 'memberCount']],
        where: { roomId: { [Op.in]: roomIds.length ? roomIds : ['__none__'] } },
        group: ['roomId'],
        raw: true
      }),
      CommunityMessage.findAll({
        attributes: ['roomId', [fn('COUNT', col('communityMessageId')), 'messageCount']],
        where: { roomId: { [Op.in]: roomIds.length ? roomIds : ['__none__'] } },
        group: ['roomId'],
        raw: true
      })
    ]);

    const roomStatsById = new Map();
    roomMemberCounts.forEach((row) => {
      roomStatsById.set(row.roomId, { memberCount: Number(row.memberCount || 0), messageCount: 0 });
    });
    roomMessageCounts.forEach((row) => {
      const current = roomStatsById.get(row.roomId) || { memberCount: 0, messageCount: 0 };
      current.messageCount = Number(row.messageCount || 0);
      roomStatsById.set(row.roomId, current);
    });

    const userIdsInMessages = [...new Set(communityMessages.map((item) => item.senderUserId))];
    const messageUsers = await UserAccount.findAll({
      attributes: ['userId', 'userRole'],
      where: { userId: { [Op.in]: userIdsInMessages.length ? userIdsInMessages : ['__none__'] } },
      raw: true
    });
    const userRoleById = new Map(messageUsers.map((user) => [user.userId, normalizeRole(user.userRole)]));

    function resolveSenderName(userId) {
      const role = userRoleById.get(userId) || 'UNKNOWN';
      if (role === 'SURVIVOR') return nicknameByUserId.get(userId) || 'Anonymous Survivor';
      if (role === 'COUNSELLOR') return 'Verified Counsellor';
      if (role === 'LEGAL_COUNSEL') return 'Verified Legal Counsel';
      if (role === 'NGO_ADMIN') return 'Verified NGO Administrator';
      return 'Community Member';
    }

    const full30DaySeries = buildLast30DaySeries(reportsOverTimeRows);

    const counsellorCountMap = new Map(
      survivorsWithAssignments
        .filter((row) => row.assignedCounsellorId)
        .reduce((acc, row) => {
          const current = acc.get(row.assignedCounsellorId) || 0;
          acc.set(row.assignedCounsellorId, current + 1);
          return acc;
        }, new Map())
    );

    const legalCountMap = new Map(
      survivorsWithAssignments
        .filter((row) => row.assignedLegalCounselId)
        .reduce((acc, row) => {
          const current = acc.get(row.assignedLegalCounselId) || 0;
          acc.set(row.assignedLegalCounselId, current + 1);
          return acc;
        }, new Map())
    );

    return res.json({
      overview: {
        totalReports,
        reportTrendPercent: reportTrend,
        activeSurvivors,
        averageResponseMinutes: avgResponseMinutes,
        activeLegalCases
      },
      reportsOverTime: full30DaySeries,
      reportsBreakdown: {
        byCategory: reportsByCategoryRows.map((row) => ({ category: row.incidentCategory, count: Number(row.count || 0) })),
        byStatus: reportsByStatusRows.map((row) => ({ status: row.currentReportStatus, count: Number(row.count || 0) })),
        byCounty: reportsByCountyRows.map((row) => ({ county: row.county || 'Unknown', count: Number(row.count || 0) }))
      },
      communityMetrics: {
        activeRooms: communityRooms.length,
        totalMessages: Number(totalCommunityMessages || 0),
        harmfulContentReports: Number(harmfulContentReportCount || 0)
      },
      staffWorkload: {
        counsellors: counsellorWorkload.map((row) => ({
          id: row.counsellorId,
          role: 'COUNSELLOR',
          label: `Counsellor ${shortCode(row.counsellorId)}`,
          specialization: row.professionalSpecialization || 'General Support',
          workload: Number(row.currentWorkloadScore || 0),
          activeCases: counsellorCountMap.get(row.counsellorId) || 0,
          availability: row.availabilityStatus,
          userId: row.userAccount?.userId
        })),
        legalCounsel: legalWorkload.map((row) => ({
          id: row.legalCounselId,
          role: 'LEGAL_COUNSEL',
          label: `Legal Counsel ${shortCode(row.legalCounselId)}`,
          specialization: row.professionalSpecialization || 'General Legal Support',
          workload: Number(row.currentWorkloadScore || 0),
          activeCases: legalCountMap.get(row.legalCounselId) || 0,
          availability: row.availabilityStatus,
          userId: row.userAccount?.userId
        }))
      },
      staffDirectory: [
        ...counsellorWorkload.map((row) => ({
          id: row.counsellorId,
          type: 'COUNSELLOR',
          label: `Counsellor ${shortCode(row.counsellorId)}`,
          specialization: row.professionalSpecialization || 'General Support',
          activeCases: counsellorCountMap.get(row.counsellorId) || 0,
          availability: row.availabilityStatus,
          userId: row.userAccount?.userId
        })),
        ...legalWorkload.map((row) => ({
          id: row.legalCounselId,
          type: 'LEGAL_COUNSEL',
          label: `Legal Counsel ${shortCode(row.legalCounselId)}`,
          specialization: row.professionalSpecialization || 'General Legal Support',
          activeCases: legalCountMap.get(row.legalCounselId) || 0,
          availability: row.availabilityStatus,
          userId: row.userAccount?.userId
        }))
      ],
      survivorAssignments: survivorsWithAssignments.map((row) => ({
        survivorId: row.survivorId,
        nickname: row.displayNickname || `Survivor ${shortCode(row.survivorId)}`,
        county: row.residenceCounty,
        assignedCounsellorId: row.assignedCounsellorId,
        assignedLegalCounselId: row.assignedLegalCounselId
      })),
      recentUrgentCases: urgentCases,
      moderationQueue: moderationQueue.map((row) => ({
        reportId: row.contentReportId,
        submittedAt: row.reportSubmissionTimestamp,
        roomName: row.reportedMessage?.communityRoom?.roomName || 'General',
        snippet: row.reportedMessage?.publicMessageContent || row.reportReasonText,
        status: row.moderationReviewStatus
      })),
      notifications: urgentNotifications,
      recentCommunityMessages: communityMessages.map((item) => ({
        messageId: item.communityMessageId,
        roomId: item.roomId,
        roomName: item.communityRoom?.roomName || 'General Support',
        senderName: resolveSenderName(item.senderUserId),
        content: item.publicMessageContent,
        sentAt: item.messageDispatchTimestamp
      })),
      communityRooms: communityRooms.map((room) => ({
        roomId: room.roomId,
        roomName: room.roomName,
        memberCount: roomStatsById.get(room.roomId)?.memberCount || 0,
        messageCount: roomStatsById.get(room.roomId)?.messageCount || 0,
        createdAt: room.roomCreationTimestamp
      })),
      recentReports: recentReports,
      resources: postedResources.map((resource) => ({
        resourceId: resource.resourceId,
        title: resource.resourceTitle,
        description: resource.resourceDescription,
        category: resource.resourceCategory,
        fileUrl: resource.resourceFileUrl,
        uploadedAt: resource.resourceUploadTimestamp,
        uploadedBy: {
          userId: resource.uploadedBy?.userId,
          phoneNumber: resource.uploadedBy?.phoneNumber,
          role: resource.uploadedBy?.userRole
        }
      })),
      resourceAnalytics: {
        topAccessedResources: topResourceAccessRows.map((row) => ({
          resourceId: row.resourceId,
          title: row.supportResource?.resourceTitle || row.resourceId,
          category: row.supportResource?.resourceCategory || 'unknown',
          accessCount: Number(row.get('accessCount') || 0)
        })),
        usageByCategory: resourceUsageByCategoryRows.map((row) => ({
          category: row.category || 'unknown',
          accessCount: Number(row.accessCount || 0)
        }))
      },
      profile: {
        role: actor.role,
        userId: actor.userId,
        department: ngoAdminProfile?.administrativeDepartment || 'NGO Operations',
        accessLevel: ngoAdminProfile?.administratorAccessLevel || 1
      }
    });
  } catch (error) {
    console.error('NGO dashboard error:', error);
    return res.status(500).json({ error: 'Failed to load NGO admin dashboard.' });
  }
}

/**
 * createNgoResource
 * -----------------
 * NGO-admin publishing endpoint for survivor/staff resource library entries.
 */
async function createNgoResource(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || '').trim().toLowerCase();
    const fileUrl = String(req.body?.fileUrl || '').trim();

    if (!title || !category || !fileUrl) {
      return res.status(400).json({ error: 'title, category, and fileUrl are required.' });
    }

    const created = await SupportResource.create({
      resourceId: randomUUID(),
      resourceTitle: title,
      resourceDescription: description || null,
      resourceCategory: category,
      resourceFileUrl: fileUrl,
      uploadedByStaffId: actor.userId
    });

    return res.status(201).json({
      resource: {
        resourceId: created.resourceId,
        title: created.resourceTitle,
        description: created.resourceDescription,
        category: created.resourceCategory,
        fileUrl: created.resourceFileUrl,
        uploadedAt: created.resourceUploadTimestamp,
        uploadedBy: actor.userId
      }
    });
  } catch (error) {
    console.error('Create NGO resource error:', error);
    return res.status(500).json({ error: 'Failed to create resource.' });
  }
}

/**
 * updateNgoResource
 * -----------------
 * Partial update endpoint for NGO-managed support resources.
 */
async function updateNgoResource(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const resource = await SupportResource.findByPk(req.params.resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : null;
    const description = req.body?.description !== undefined ? String(req.body.description).trim() : null;
    const category = req.body?.category !== undefined ? String(req.body.category).trim().toLowerCase() : null;
    const fileUrl = req.body?.fileUrl !== undefined ? String(req.body.fileUrl).trim() : null;

    if (title !== null && !title) {
      return res.status(400).json({ error: 'title cannot be empty.' });
    }
    if (category !== null && !category) {
      return res.status(400).json({ error: 'category cannot be empty.' });
    }
    if (fileUrl !== null && !fileUrl) {
      return res.status(400).json({ error: 'fileUrl cannot be empty.' });
    }

    if (title !== null) resource.resourceTitle = title;
    if (description !== null) resource.resourceDescription = description || null;
    if (category !== null) resource.resourceCategory = category;
    if (fileUrl !== null) resource.resourceFileUrl = fileUrl;

    await resource.save();

    return res.json({
      resource: {
        resourceId: resource.resourceId,
        title: resource.resourceTitle,
        description: resource.resourceDescription,
        category: resource.resourceCategory,
        fileUrl: resource.resourceFileUrl,
        uploadedAt: resource.resourceUploadTimestamp,
        uploadedBy: resource.uploadedByStaffId
      }
    });
  } catch (error) {
    console.error('Update NGO resource error:', error);
    return res.status(500).json({ error: 'Failed to update resource.' });
  }
}

/**
 * reassignSurvivor
 * ----------------
 * Manual staffing override endpoint for NGO admins.
 * Persists assignment history and refreshes workload scores.
 */
async function reassignSurvivor(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const survivorId = String(req.body?.survivorId || '').trim();
    const counsellorId = req.body?.counsellorId ? String(req.body.counsellorId).trim() : null;
    const legalCounselId = req.body?.legalCounselId ? String(req.body.legalCounselId).trim() : null;
    const reason = String(req.body?.reason || '').trim() || 'Manual reassignment by NGO Admin';

    if (!survivorId) {
      return res.status(400).json({ error: 'survivorId is required.' });
    }

    const survivor = await SurvivorProfile.findByPk(survivorId);
    if (!survivor) {
      return res.status(404).json({ error: 'Survivor profile not found.' });
    }

    if (counsellorId) {
      const counsellor = await CounsellorProfile.findByPk(counsellorId);
      if (!counsellor) {
        return res.status(404).json({ error: 'Counsellor profile not found.' });
      }
    }

    if (legalCounselId) {
      const legalCounsel = await LegalCounselProfile.findByPk(legalCounselId);
      if (!legalCounsel) {
        return res.status(404).json({ error: 'Legal counsel profile not found.' });
      }
    }

    await survivor.update({
      assignedCounsellorId: counsellorId || null,
      assignedLegalCounselId: legalCounselId || null
    });

    await StaffAssignmentHistory.create({
      assignmentHistoryId: randomUUID(),
      survivorId: survivor.survivorId,
      counsellorId: survivor.assignedCounsellorId,
      legalCounselId: survivor.assignedLegalCounselId,
      assignmentReason: reason
    });

    await refreshWorkloadScores();

    return res.json({
      message: 'Assignment updated successfully.',
      assignment: {
        survivorId: survivor.survivorId,
        counsellorId: survivor.assignedCounsellorId,
        legalCounselId: survivor.assignedLegalCounselId
      }
    });
  } catch (error) {
    console.error('Reassign survivor error:', error);
    return res.status(500).json({ error: 'Failed to reassign survivor.' });
  }
}

/**
 * globalSearch
 * ------------
 * Cross-entity operational search for admin triage workflows.
 * Currently searches report ids and user account identifiers.
 */
async function globalSearch(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (!['NGO_ADMIN', 'SYSTEM_ADMIN'].includes(actor.role)) {
      return roleForbidden(res, ['NGO_ADMIN', 'SYSTEM_ADMIN']);
    }

    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.json({ results: [] });
    }

    const [reportMatches, userMatches] = await Promise.all([
      IncidentReport.findAll({
        attributes: ['reportId', 'currentReportStatus', 'severityLevel', 'reportCreationTimestamp'],
        where: {
          reportId: {
            [Op.like]: `%${q}%`
          }
        },
        limit: 8,
        order: [['reportCreationTimestamp', 'DESC']],
        raw: true
      }),
      UserAccount.findAll({
        attributes: ['userId', 'phoneNumber', 'userRole', 'accountStatus'],
        where: {
          [Op.or]: [
            { userId: { [Op.like]: `%${q}%` } },
            { phoneNumber: { [Op.like]: `%${q}%` } }
          ]
        },
        limit: 8,
        order: [['createdAt', 'DESC']],
        raw: true
      })
    ]);

    const results = [
      ...reportMatches.map((item) => ({ type: 'CASE', ...item })),
      ...userMatches.map((item) => ({ type: 'USER', ...item }))
    ];

    return res.json({ results });
  } catch (error) {
    console.error('Admin global search error:', error);
    return res.status(500).json({ error: 'Failed to perform admin search.' });
  }
}

/**
 * getSystemDashboard
 * ------------------
 * Returns the consolidated System Admin control-plane payload.
 */
async function getSystemDashboard(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SYSTEM_ADMIN') return roleForbidden(res, ['SYSTEM_ADMIN']);

    // Lightweight DB latency check for infrastructure visibility in UI.
    const started = Date.now();
    let databaseStatus = 'DOWN';
    let dbLatencyMs = null;

    try {
      await sequelize.authenticate();
      databaseStatus = 'UP';
      dbLatencyMs = Date.now() - started;
    } catch {
      databaseStatus = 'DOWN';
    }

    const smsConfigured = Boolean(process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME);

    const [adminDirectory, recentAuditLogs, profile] = await Promise.all([
      SystemAdministratorProfile.findAll({
        attributes: ['systemAdminId', 'systemAccessLevel', 'maintenancePrivileges'],
        include: [{ model: UserAccount, attributes: ['userId', 'phoneNumber', 'accountStatus'] }],
        order: [['systemAccessLevel', 'DESC']]
      }),
      AuditLog.findAll({
        attributes: ['actionType', 'actionTimestamp', 'targetEntity'],
        order: [['actionTimestamp', 'DESC']],
        limit: 25,
        raw: true
      }),
      SystemAdministratorProfile.findOne({
        where: { userId: actor.userId },
        attributes: ['systemAccessLevel', 'maintenancePrivileges']
      })
    ]);

    const staffUsers = await UserAccount.findAll({
      attributes: ['userId', 'phoneNumber', 'userRole', 'accountStatus', 'status', 'accountCreationTimestamp'],
      where: {
        userRole: { [Op.in]: ['COUNSELLOR', 'LEGAL_COUNSEL', 'NGO_ADMIN', 'SYSTEM_ADMIN'] }
      },
      order: [['accountCreationTimestamp', 'DESC']],
      raw: true
    });

    const uptimeSeconds = Math.floor(process.uptime());

    return res.json({
      statusBadge: databaseStatus === 'UP' ? 'ALL_SYSTEMS_OPERATIONAL' : 'DEGRADED_PERFORMANCE',
      maintenanceMode: {
        enabled: maintenanceModeEnabled,
        updatedAt: maintenanceUpdatedAt,
        reason: maintenanceReason,
        expectedUntil: maintenanceExpectedUntil
      },
      runtimeActions: {
        lastCacheClearAt,
        lastRestartRequestAt
      },
      metrics: {
        serverUptimeSeconds: uptimeSeconds,
        databaseConnectionStatus: databaseStatus,
        databaseLatencyMs: dbLatencyMs,
        otpGatewayStatus: smsConfigured ? 'CONFIGURED' : 'MISSING_CONFIGURATION'
      },
      errorLogs: recentAuditLogs.map((log) => ({
        timestamp: log.actionTimestamp,
        faultCode: 'AUDIT_EVENT',
        module: log.actionType || 'SYSTEM',
        description: log.targetEntity
          ? `Action target: ${log.targetEntity}`
          : 'No target entity provided.'
      })),
      adminDirectory: adminDirectory.map((entry) => ({
        id: entry.systemAdminId,
        userId: entry.userAccount?.userId,
        phoneNumber: entry.userAccount?.phoneNumber,
        accountStatus: entry.userAccount?.accountStatus,
        systemAccessLevel: entry.systemAccessLevel,
        maintenancePrivileges: entry.maintenancePrivileges
      })),
      staffDirectory: staffUsers.map((staff) => ({
        userId: staff.userId,
        phoneNumber: staff.phoneNumber,
        role: staff.userRole,
        accountStatus: staff.accountStatus,
        passwordResetRequired: String(staff.status || '').toLowerCase() === 'password_reset_required',
        createdAt: staff.accountCreationTimestamp
      })),
      profile: {
        role: actor.role,
        userId: actor.userId,
        systemAccessLevel: profile?.systemAccessLevel || 1
      }
    });
  } catch (error) {
    console.error('System dashboard error:', error);
    return res.status(500).json({ error: 'Failed to load system admin dashboard.' });
  }
}

async function setMaintenanceMode(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SYSTEM_ADMIN') return roleForbidden(res, ['SYSTEM_ADMIN']);

    // Enables/disables global maintenance gate and optional user-facing metadata.
    const { enabled, reason, expectedUntil } = req.body || {};
    maintenanceModeEnabled = Boolean(enabled);
    maintenanceUpdatedAt = new Date().toISOString();

    if (maintenanceModeEnabled) {
      const parsedReason = String(reason || '').trim();
      maintenanceReason = parsedReason || 'Scheduled platform maintenance in progress.';

      const parsedExpectedUntil = expectedUntil ? new Date(String(expectedUntil)) : null;
      maintenanceExpectedUntil = parsedExpectedUntil && !Number.isNaN(parsedExpectedUntil.getTime())
        ? parsedExpectedUntil.toISOString()
        : null;
    } else {
      maintenanceReason = null;
      maintenanceExpectedUntil = null;
    }

    return res.json({
      message: `Maintenance mode ${maintenanceModeEnabled ? 'enabled' : 'disabled'}.`,
      maintenanceMode: {
        enabled: maintenanceModeEnabled,
        updatedAt: maintenanceUpdatedAt,
        reason: maintenanceReason,
        expectedUntil: maintenanceExpectedUntil
      }
    });
  } catch (error) {
    console.error('Maintenance mode update error:', error);
    return res.status(500).json({ error: 'Failed to update maintenance mode.' });
  }
}

/**
 * getSystemLogs
 * -------------
 * Returns audit events shaped as "live logs" for the System Admin dashboard.
 *
 * The `since` query parameter is optional and allows incremental polling.
 */
async function getSystemLogs(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SYSTEM_ADMIN') return roleForbidden(res, ['SYSTEM_ADMIN']);

    // Optional incremental polling support via `since` query parameter.
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const where = {};
    if (since && !Number.isNaN(since.getTime())) {
      where.actionTimestamp = { [Op.gt]: since };
    }

    const logs = await AuditLog.findAll({
      attributes: ['actionType', 'actionTimestamp', 'targetEntity'],
      where,
      order: [['actionTimestamp', 'DESC']],
      limit: 40,
      raw: true
    });

    return res.json({
      generatedAt: new Date().toISOString(),
      logs: logs.map((log) => ({
        timestamp: log.actionTimestamp,
        faultCode: 'AUDIT_EVENT',
        module: log.actionType || 'SYSTEM',
        description: log.targetEntity ? `Action target: ${log.targetEntity}` : 'No target entity provided.'
      }))
    });
  } catch (error) {
    console.error('System logs fetch error:', error);
    return res.status(500).json({ error: 'Failed to load live logs.' });
  }
}

/**
 * performRuntimeAction
 * --------------------
 * Supports two controlled runtime operations:
 * - CLEAR_CACHE: writes an operation marker and audit entry
 * - RESTART_SERVER: records a restart request; optional process exit is env-gated
 */
async function performRuntimeAction(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SYSTEM_ADMIN') return roleForbidden(res, ['SYSTEM_ADMIN']);

    const action = String(req.body?.action || '').trim().toUpperCase();
    if (!['CLEAR_CACHE', 'RESTART_SERVER'].includes(action)) {
      return res.status(400).json({ error: 'action must be CLEAR_CACHE or RESTART_SERVER.' });
    }

    if (action === 'CLEAR_CACHE') {
      // Runtime cache clear is represented as an auditable operation marker.
      lastCacheClearAt = new Date().toISOString();
      await AuditLog.create({
        auditId: randomUUID(),
        actorUserId: actor.userId,
        actionType: 'SYSTEM_CACHE_CLEAR',
        targetEntity: 'runtime_cache'
      });

      return res.json({
        message: 'System cache cleared successfully.',
        runtimeActions: {
          lastCacheClearAt,
          lastRestartRequestAt
        }
      });
    }

    lastRestartRequestAt = new Date().toISOString();
    await AuditLog.create({
      auditId: randomUUID(),
      actorUserId: actor.userId,
      actionType: 'SYSTEM_RESTART_REQUESTED',
      targetEntity: 'node_runtime'
    });

    // Auto-exit restart is intentionally opt-in to avoid accidental downtime.
    const restartEnabled = process.env.ALLOW_ADMIN_RESTART === 'true';
    if (restartEnabled) {
      setTimeout(() => process.exit(0), 250);
      return res.json({
        message: 'Restart requested. Server will stop and rely on the process manager to restart it.',
        runtimeActions: {
          lastCacheClearAt,
          lastRestartRequestAt
        }
      });
    }

    return res.json({
      message: 'Restart request recorded. Set ALLOW_ADMIN_RESTART=true to enable auto-exit based restart.',
      runtimeActions: {
        lastCacheClearAt,
        lastRestartRequestAt
      }
    });
  } catch (error) {
    console.error('Runtime action error:', error);
    return res.status(500).json({ error: 'Failed to execute runtime action.' });
  }
}

/**
 * createStaffAccount
 * ------------------
 * System-admin onboarding endpoint for internal staff roles.
 *
 * Security/operations notes:
 * - role is strictly allow-listed
 * - account starts in `password_reset_required` status
 * - profile rows are created according to role
 * - action is audit-logged
 */
async function createStaffAccount(req, res) {
  // Transaction guarantees user + profile + audit log are either all committed or all rolled back.
  const transaction = await sequelize.transaction();

  try {
    const actor = await getActor(req);
    if (!actor) {
      await transaction.rollback();
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (actor.role !== 'SYSTEM_ADMIN') {
      await transaction.rollback();
      return roleForbidden(res, ['SYSTEM_ADMIN']);
    }

    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const password = String(req.body?.password || '').trim();
    const role = normalizeRole(req.body?.role);

    if (!phoneNumber || !password || !role) {
      await transaction.rollback();
      return res.status(400).json({ error: 'phoneNumber, password, and role are required.' });
    }
    if (password.length < 6) {
      await transaction.rollback();
      return res.status(400).json({ error: 'password must be at least 6 characters.' });
    }

    const allowedRoles = ['COUNSELLOR', 'LEGAL_COUNSEL', 'NGO_ADMIN', 'SYSTEM_ADMIN'];
    if (!allowedRoles.includes(role)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'role must be COUNSELLOR, LEGAL_COUNSEL, NGO_ADMIN, or SYSTEM_ADMIN.' });
    }

    const existing = await UserAccount.findOne({ where: { phoneNumber }, transaction });
    if (existing) {
      await transaction.rollback();
      return res.status(409).json({ error: 'An account with this phone number already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // New staff must reset temporary password at first successful login.
    const user = await UserAccount.create({
      userId: randomUUID(),
      phoneNumber,
      hashedPassword,
      userRole: role,
      role: compatibilityRoleForUserRole(role),
      status: 'password_reset_required',
      accountStatus: 'ACTIVE',
      isOtpVerified: true
    }, { transaction });

    if (role === 'COUNSELLOR') {
      await CounsellorProfile.create({
        counsellorId: randomUUID(),
        userId: user.userId,
        professionalSpecialization: String(req.body?.specialization || '').trim() || 'General Support',
        currentWorkloadScore: 0,
        availabilityStatus: String(req.body?.availabilityStatus || 'AVAILABLE').trim().toUpperCase()
      }, { transaction });
    }

    if (role === 'LEGAL_COUNSEL') {
      await LegalCounselProfile.create({
        legalCounselId: randomUUID(),
        userId: user.userId,
        professionalSpecialization: String(req.body?.specialization || '').trim() || 'General Legal Support',
        currentWorkloadScore: 0,
        availabilityStatus: String(req.body?.availabilityStatus || 'AVAILABLE').trim().toUpperCase()
      }, { transaction });
    }

    if (role === 'NGO_ADMIN') {
      await NgoAdministratorProfile.create({
        ngoAdminId: randomUUID(),
        userId: user.userId,
        administrativeDepartment: String(req.body?.administrativeDepartment || '').trim() || 'Operations',
        administratorAccessLevel: Number(req.body?.accessLevel || 1)
      }, { transaction });
    }

    if (role === 'SYSTEM_ADMIN') {
      await SystemAdministratorProfile.create({
        systemAdminId: randomUUID(),
        userId: user.userId,
        maintenancePrivileges: String(req.body?.maintenancePrivileges || '').trim() || 'server_restart,log_access,cache_control',
        systemAccessLevel: Number(req.body?.accessLevel || 1)
      }, { transaction });
    }

    await AuditLog.create({
      auditId: randomUUID(),
      actorUserId: actor.userId,
      actionType: 'STAFF_ACCOUNT_CREATED',
      targetEntity: `${role}:${user.userId}`
    }, { transaction });

    await transaction.commit();

    return res.status(201).json({
      message: 'Staff account created successfully.',
      staff: {
        userId: user.userId,
        phoneNumber: user.phoneNumber,
        role: user.userRole,
        accountStatus: user.accountStatus
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Create staff account error:', error);
    return res.status(500).json({ error: 'Failed to create staff account.' });
  }
}

/**
 * updateStaffAccountStatus
 * ------------------------
 * Limited status transition endpoint used by Admin Access directory actions.
 *
 * Only ACTIVE <-> SUSPENDED is allowed from this route to avoid accidental
 * destructive state changes.
 */
async function updateStaffAccountStatus(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'SYSTEM_ADMIN') return roleForbidden(res, ['SYSTEM_ADMIN']);

    const userId = String(req.params.userId || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();

    if (!userId) {
      return res.status(400).json({ error: 'userId is required.' });
    }

    // Deliberately limited to ACTIVE/SUSPENDED to avoid accidental hard deactivation.
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACTIVE or SUSPENDED.' });
    }

    const targetUser = await UserAccount.findByPk(userId, {
      attributes: ['userId', 'userRole', 'accountStatus']
    });
    if (!targetUser) {
      return res.status(404).json({ error: 'Staff account not found.' });
    }

    if (!['COUNSELLOR', 'LEGAL_COUNSEL', 'NGO_ADMIN', 'SYSTEM_ADMIN'].includes(targetUser.userRole)) {
      return res.status(400).json({ error: 'Only staff accounts can be suspended or reactivated.' });
    }

    if (targetUser.userId === actor.userId && status === 'SUSPENDED') {
      return res.status(400).json({ error: 'You cannot suspend your own active system admin account.' });
    }

    targetUser.accountStatus = status;
    await targetUser.save();

    await AuditLog.create({
      auditId: randomUUID(),
      actorUserId: actor.userId,
      actionType: status === 'SUSPENDED' ? 'STAFF_ACCOUNT_SUSPENDED' : 'STAFF_ACCOUNT_REACTIVATED',
      targetEntity: `${targetUser.userRole}:${targetUser.userId}`
    });

    return res.json({
      message: `Staff account ${status === 'SUSPENDED' ? 'suspended' : 'reactivated'} successfully.`,
      staff: {
        userId: targetUser.userId,
        role: targetUser.userRole,
        accountStatus: targetUser.accountStatus
      }
    });
  } catch (error) {
    console.error('Update staff status error:', error);
    return res.status(500).json({ error: 'Failed to update staff account status.' });
  }
}

function getMaintenanceModeState() {
  // Shared helper used by public-status endpoint and maintenance guard responses.
  return {
    enabled: maintenanceModeEnabled,
    updatedAt: maintenanceUpdatedAt,
    reason: maintenanceReason,
    expectedUntil: maintenanceExpectedUntil
  };
}

/**
 * maintenanceGuard
 * ----------------
 * Global middleware gate used by backend/index.js.
 *
 * When maintenance mode is enabled, only operational recovery surfaces remain
 * reachable: status checks, health checks, and admin endpoints.
 */
function maintenanceGuard(req, res, next) {
  // Global request gate used by backend/index.js.
  // Allows health/admin/status endpoints so operators can recover the platform.
  if (!maintenanceModeEnabled) return next();

  if (req.path === '/api/system/public-status') return next();
  if (req.path.startsWith('/api/admin')) return next();
  if (req.path.startsWith('/api/health')) return next();

  const role = getRoleFromAuthHeader(req);
  if (role === 'SYSTEM_ADMIN') return next();

  return res.status(503).json({
    error: 'System is currently under maintenance. Please try again later.',
    maintenanceMode: getMaintenanceModeState()
  });
}

module.exports = {
  getNgoDashboard,
  getSystemDashboard,
  globalSearch,
  setMaintenanceMode,
  createNgoResource,
  updateNgoResource,
  reassignSurvivor,
  getSystemLogs,
  performRuntimeAction,
  createStaffAccount,
  updateStaffAccountStatus,
  getMaintenanceModeState,
  maintenanceGuard
};
