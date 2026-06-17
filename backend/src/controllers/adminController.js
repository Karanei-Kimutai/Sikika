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
  DirectChatChannel,
  DirectChatMessage,
  LegalCaseFile,
  NgoAdministratorProfile,
  ModeratorProfile,
  AuditLog,
  ModerationActionLog,
  SupportResource,
  StaffAssignmentHistory,
  ResourceAccessEvent,
  SystemSetting
} = require('../models');
const { ensureAutoChannelsForSurvivor } = require('../services/chatAccessService');
const { normalizeRole, BANNABLE_ROLES } = require('../utils/roles');

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
 * - staff onboarding and staff account lifecycle status updates
 */

/**
 * Maintenance mode cache — loaded from DB at boot via loadMaintenanceStateFromDb().
 * Write-through: every toggle goes to SystemSetting AND updates this cache so the
 * in-process guard (maintenanceGuard) can check without a DB round-trip per request.
 */
let _maintenanceCache = {
  enabled: false,
  updatedAt: null,
  reason: null,
  expectedUntil: null
};

// MAINTENANCE_SETTING_KEY is the SystemSetting PK for durable maintenance state.
const MAINTENANCE_SETTING_KEY = 'maintenance';

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

function compatibilityRoleForUserRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'LEGAL_COUNSEL') return 'legal_counsel';
  if (normalized === 'NGO_ADMIN') return 'ngo_admin';
  if (normalized === 'MODERATOR') return 'moderator';
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

/**
 * getActor
 * --------
 * Resolves ACTIVE authenticated actor context from auth middleware claims.
 *
 * Returns null when token identity is missing, user does not exist, or account
 * is not in ACTIVE status.
 */
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

function computeAverageStaffResponseMinutes({ channels, messages }) {
  if (!Array.isArray(channels) || !Array.isArray(messages) || !channels.length || !messages.length) {
    return { averageMinutes: 0, sampleSize: 0 };
  }

  const channelMetaById = new Map(
    channels
      .filter((row) => row?.chatId && row?.supportStaffCounterpartId && row?.survivorProfile?.userId)
      .map((row) => [
        row.chatId,
        {
          staffUserId: row.supportStaffCounterpartId,
          survivorUserId: row.survivorProfile.userId
        }
      ])
  );

  const messagesByChannel = new Map();
  for (const row of messages) {
    if (!row?.chatId || !row?.messageDispatchTimestamp) continue;
    const list = messagesByChannel.get(row.chatId) || [];
    list.push(row);
    messagesByChannel.set(row.chatId, list);
  }

  const responseMinutes = [];

  for (const [chatId, messageRows] of messagesByChannel.entries()) {
    const meta = channelMetaById.get(chatId);
    if (!meta) continue;

    const ordered = [...messageRows].sort(
      (a, b) => new Date(a.messageDispatchTimestamp).getTime() - new Date(b.messageDispatchTimestamp).getTime()
    );

    const firstSurvivorMessage = ordered.find((row) => row.senderUserId === meta.survivorUserId);
    if (!firstSurvivorMessage) continue;

    const firstStaffReply = ordered.find((row) => {
      if (row.senderUserId !== meta.staffUserId) return false;
      return new Date(row.messageDispatchTimestamp).getTime() > new Date(firstSurvivorMessage.messageDispatchTimestamp).getTime();
    });

    if (!firstStaffReply) continue;

    const minutes =
      (new Date(firstStaffReply.messageDispatchTimestamp).getTime() -
        new Date(firstSurvivorMessage.messageDispatchTimestamp).getTime()) /
      60000;

    if (Number.isFinite(minutes) && minutes >= 0) {
      responseMinutes.push(minutes);
    }
  }

  if (!responseMinutes.length) {
    return { averageMinutes: 0, sampleSize: 0 };
  }

  return {
    averageMinutes: Math.round(responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length),
    sampleSize: responseMinutes.length
  };
}

function roleDisplay(role) {
  if (role === 'COUNSELLOR') return 'Counsellor';
  if (role === 'LEGAL_COUNSEL') return 'Legal Counsel';
  return 'Staff';
}

function shortCode(value) {
  return String(value || '').replace(/-/g, '').slice(0, 6).toUpperCase();
}

/**
 * refreshWorkloadScores
 * ---------------------
 * Recomputes counsellor/legal-counsel workload from current survivor
 * assignment links so dashboard workload metrics remain consistent.
 */
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
 * getLeastLoadedStaff
 * --------------------
 * Selects the staff profile with the lowest currentWorkloadScore, preferring
 * AVAILABLE staff and excluding a given profile id (e.g. the staff member
 * being banned, or a survivor's current assignee when suggesting a change).
 *
 * Shared by cascadeReassignOnStaffBan (auto-reassignment on staff ban) and
 * getReassignmentSuggestions (admin-facing "Recommended" suggestion in the
 * Team Capacity manual reassignment form).
 *
 * @param {Model}  ProfileModel - CounsellorProfile or LegalCounselProfile.
 * @param {string} idField      - PK field name ('counsellorId' / 'legalCounselId').
 * @param {string|null} excludeId - Profile id to exclude from candidates, if any.
 * @returns {Promise<Model|null>} The recommended staff profile, or null if none exist.
 */
async function getLeastLoadedStaff(ProfileModel, idField, excludeId = null) {
  const candidates = await ProfileModel.findAll({
    attributes: [idField, 'currentWorkloadScore', 'availabilityStatus'],
    order: [['currentWorkloadScore', 'ASC'], [idField, 'ASC']]
  });

  const pool = excludeId ? candidates.filter((c) => c[idField] !== excludeId) : candidates;
  const available = pool.filter((c) => c.availabilityStatus === 'AVAILABLE');
  return available[0] || pool[0] || null;
}

/**
 * getReassignmentSuggestions
 * ---------------------------
 * GET /api/admin/ngo/reassignments/suggestions?survivorId=...
 *
 * Returns the recommended (least-loaded, available-preferred) counsellor and
 * legal counsel for a given survivor, excluding their currently assigned
 * staff. Used by the Team Capacity manual reassignment form to pre-highlight
 * a "Recommended" candidate so the admin isn't picking blind — they can still
 * override and pick someone else.
 */
async function getReassignmentSuggestions(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const survivorId = String(req.query.survivorId || '').trim();
    if (!survivorId) {
      return res.status(400).json({ error: 'survivorId is required.' });
    }

    const survivor = await SurvivorProfile.findByPk(survivorId, {
      attributes: ['survivorId', 'assignedCounsellorId', 'assignedLegalCounselId']
    });
    if (!survivor) {
      return res.status(404).json({ error: 'Survivor not found.' });
    }

    const [suggestedCounsellor, suggestedLegalCounsel] = await Promise.all([
      getLeastLoadedStaff(CounsellorProfile, 'counsellorId', survivor.assignedCounsellorId),
      getLeastLoadedStaff(LegalCounselProfile, 'legalCounselId', survivor.assignedLegalCounselId)
    ]);

    return res.json({
      suggestedCounsellorId: suggestedCounsellor?.counsellorId || null,
      suggestedLegalCounselId: suggestedLegalCounsel?.legalCounselId || null
    });
  } catch (error) {
    console.error('getReassignmentSuggestions error:', error);
    return res.status(500).json({ error: 'Failed to compute reassignment suggestion.' });
  }
}

/**
 * applySurvivorReassignment
 * -------------------------
 * Validates and applies a survivor staffing reassignment.
 *
 * Side effects:
 * - writes assignment history
 * - ensures direct-chat channels match new assignment topology
 * - refreshes workload scores for staff dashboards
 */
async function applySurvivorReassignment({ survivorId, counsellorId = null, legalCounselId = null, reason }) {
  const survivor = await SurvivorProfile.findByPk(survivorId);
  if (!survivor) {
    const error = new Error('Survivor profile not found.');
    error.statusCode = 404;
    throw error;
  }

  if (counsellorId) {
    const counsellor = await CounsellorProfile.findByPk(counsellorId);
    if (!counsellor) {
      const error = new Error('Counsellor profile not found.');
      error.statusCode = 404;
      throw error;
    }
  }

  if (legalCounselId) {
    const legalCounsel = await LegalCounselProfile.findByPk(legalCounselId);
    if (!legalCounsel) {
      const error = new Error('Legal counsel profile not found.');
      error.statusCode = 404;
      throw error;
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
    assignmentReason: String(reason || '').trim() || 'Manual reassignment by NGO Admin'
  });

  // Keep direct-chat visibility in sync with latest survivor/staff assignment.
  await ensureAutoChannelsForSurvivor(survivor);

  await refreshWorkloadScores();

  return {
    survivorId: survivor.survivorId,
    counsellorId: survivor.assignedCounsellorId,
    legalCounselId: survivor.assignedLegalCounselId
  };
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
      responseMessages,
      responseChannels,
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
      DirectChatMessage.findAll({
        attributes: ['chatId', 'senderUserId', 'messageDispatchTimestamp'],
        where: {
          messageDispatchTimestamp: { [Op.gte]: thirtyDaysAgo }
        },
        raw: true
      }),
      DirectChatChannel.findAll({
        attributes: ['chatId', 'supportStaffCounterpartId'],
        include: [{ model: SurvivorProfile, attributes: ['userId'] }]
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
        // Include accountStatus + ban fields so staff directory can render status badges
        // and NGO admins can see and act on BANNED accounts without a separate lookup.
        include: [{ model: UserAccount, attributes: ['userId', 'phoneNumber', 'accountStatus', 'banReason', 'banExpiresAt'] }],
        order: [['currentWorkloadScore', 'DESC']]
      }),
      LegalCounselProfile.findAll({
        attributes: ['legalCounselId', 'professionalSpecialization', 'currentWorkloadScore', 'availabilityStatus'],
        include: [{ model: UserAccount, attributes: ['userId', 'phoneNumber', 'accountStatus', 'banReason', 'banExpiresAt'] }],
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
        attributes: ['contentReportId', 'reportSubmissionTimestamp', 'reportReasonText', 'moderationReviewStatus', 'reporterUserId'],
        where: { moderationReviewStatus: 'PENDING' },
        include: [{
          model: CommunityMessage,
          as: 'reportedMessage',
          // senderUserId is the author of the harmful message — used by the ban workflow.
          // sender.accountStatus tells the UI whether to show "Ban User" or "Lift Ban".
          attributes: ['publicMessageContent', 'senderUserId'],
          include: [
            { model: CommunityRoom, attributes: ['roomName'] },
            { model: UserAccount, as: 'sender', attributes: ['accountStatus'] }
          ]
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

    const responseMetric = computeAverageStaffResponseMinutes({
      channels: responseChannels,
      messages: responseMessages
    });
    const avgResponseMinutes = responseMetric.averageMinutes;

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
        averageResponseSampleCount: responseMetric.sampleSize,
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
          userId: row.userAccount?.userId,
          // Ban/account status fields for NGO admin staff directory controls.
          accountStatus: row.userAccount?.accountStatus || 'ACTIVE',
          banReason: row.userAccount?.banReason || null,
          banExpiresAt: row.userAccount?.banExpiresAt || null
        })),
        ...legalWorkload.map((row) => ({
          id: row.legalCounselId,
          type: 'LEGAL_COUNSEL',
          label: `Legal Counsel ${shortCode(row.legalCounselId)}`,
          specialization: row.professionalSpecialization || 'General Legal Support',
          activeCases: legalCountMap.get(row.legalCounselId) || 0,
          availability: row.availabilityStatus,
          userId: row.userAccount?.userId,
          accountStatus: row.userAccount?.accountStatus || 'ACTIVE',
          banReason: row.userAccount?.banReason || null,
          banExpiresAt: row.userAccount?.banExpiresAt || null
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
        reporterLabel: row.reporterUserId ? `Reporter ${shortCode(row.reporterUserId)}` : 'Community Member',
        roomName: row.reportedMessage?.communityRoom?.roomName || 'General',
        snippet: row.reportedMessage?.publicMessageContent || row.reportReasonText,
        reportReasonText: row.reportReasonText,
        status: row.moderationReviewStatus,
        // senderUserId is the author of the reported message — used by the ban workflow
        // in the NGO admin moderation desk to ban the offending community member.
        senderUserId: row.reportedMessage?.senderUserId || null,
        // senderAccountStatus tells the UI whether to show "Ban User" or "Lift Ban"
        // for this queue row — avoids a separate per-row lookup.
        senderAccountStatus: row.reportedMessage?.sender?.accountStatus || null
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

    const assignment = await applySurvivorReassignment({
      survivorId,
      counsellorId,
      legalCounselId,
      reason
    });

    return res.json({
      message: 'Assignment updated successfully.',
      assignment
    });
  } catch (error) {
    console.error('Reassign survivor error:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
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
    if (actor.role !== 'NGO_ADMIN') {
      return roleForbidden(res, ['NGO_ADMIN']);
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
 * setMaintenanceMode
 * ------------------
 * Toggles global maintenance mode and stores optional public-facing metadata
 * (reason and expected completion time). NGO_ADMIN-gated — System Admin and
 * its standalone infrastructure dashboard have been removed; maintenance mode
 * is the one System-Admin capability retained, folded into the NGO Admin dashboard.
 */
async function setMaintenanceMode(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const { enabled, reason, expectedUntil } = req.body || {};
    const updatedAt = new Date().toISOString();

    let parsedReason = null;
    let parsedExpectedUntil = null;

    if (Boolean(enabled)) {
      const rawReason = String(reason || '').trim();
      parsedReason = rawReason || 'Scheduled platform maintenance in progress.';

      const rawExpected = expectedUntil ? new Date(String(expectedUntil)) : null;
      parsedExpectedUntil = rawExpected && !Number.isNaN(rawExpected.getTime())
        ? rawExpected.toISOString()
        : null;
    }

    // Write-through to DB so state survives process restarts.
    const payload = {
      enabled: Boolean(enabled),
      updatedAt,
      reason: parsedReason,
      expectedUntil: parsedExpectedUntil
    };

    await SystemSetting.upsert({
      settingKey: MAINTENANCE_SETTING_KEY,
      settingValue: JSON.stringify(payload)
    });

    // Update in-process cache so the maintenance guard works without a DB hit.
    _maintenanceCache = payload;

    return res.json({
      message: `Maintenance mode ${payload.enabled ? 'enabled' : 'disabled'}.`,
      maintenanceMode: payload
    });
  } catch (error) {
    console.error('Maintenance mode update error:', error);
    return res.status(500).json({ error: 'Failed to update maintenance mode.' });
  }
}

/**
 * createStaffAccount
 * ------------------
 * NGO-admin onboarding endpoint for counsellor/legal-counsel staff roles.
 *
 * Security/operations notes:
 * - caller must be an ACTIVE NGO_ADMIN account
 * - role is strictly allow-listed
 * - account starts in `password_reset_required` status
 * - profile rows are created according to role
 * - action is audit-logged
 *
 * Why this endpoint exists under NGO governance:
 * - NGO admins own frontline staffing operations
 * - system admins retain infra/runtime controls only
 * - separating these concerns narrows accidental privilege overlap
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
    if (actor.role !== 'NGO_ADMIN') {
      await transaction.rollback();
      return roleForbidden(res, ['NGO_ADMIN']);
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

    // Intentionally limited to frontline staff + moderator roles only.
    // NGO_ADMIN accounts are out of scope for this provisioning path.
    const allowedRoles = ['COUNSELLOR', 'LEGAL_COUNSEL', 'MODERATOR'];
    if (!allowedRoles.includes(role)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'role must be COUNSELLOR, LEGAL_COUNSEL, or MODERATOR.' });
    }

    const existing = await UserAccount.findOne({ where: { phoneNumber }, transaction });
    if (existing) {
      await transaction.rollback();
      return res.status(409).json({ error: 'An account with this phone number already exists.' });
    }

    // Hashing is done at creation time because a temporary plaintext password
    // may be supplied by NGO operations during onboarding.
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
      // Counsellor metadata seeds assignment and workload dashboards immediately.
      await CounsellorProfile.create({
        counsellorId: randomUUID(),
        userId: user.userId,
        professionalSpecialization: String(req.body?.specialization || '').trim() || 'General Support',
        currentWorkloadScore: 0,
        availabilityStatus: String(req.body?.availabilityStatus || 'AVAILABLE').trim().toUpperCase()
      }, { transaction });
    }

    if (role === 'LEGAL_COUNSEL') {
      // Legal-counsel metadata is parallel to counsellors for consistent UI/analytics shaping.
      await LegalCounselProfile.create({
        legalCounselId: randomUUID(),
        userId: user.userId,
        professionalSpecialization: String(req.body?.specialization || '').trim() || 'General Legal Support',
        currentWorkloadScore: 0,
        availabilityStatus: String(req.body?.availabilityStatus || 'AVAILABLE').trim().toUpperCase()
      }, { transaction });
    }

    if (role === 'MODERATOR') {
      // Moderator profile has no availability/specialization — just a workload counter.
      await ModeratorProfile.create({
        moderatorId: randomUUID(),
        userId: user.userId,
        currentWorkloadScore: 0
      }, { transaction });
    }

    // Auditing captures both actor and role-scoped target for traceability.
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
 *
 * Governance notes:
 * - only NGO admins can trigger these transitions
 * - only counsellor/legal-counsel accounts can be targeted
 * - DEACTIVATED transitions remain intentionally unavailable here
 */
async function updateStaffAccountStatus(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

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

    // Restricting status actions to frontline staff + moderators avoids cross-admin role tampering.
    if (!['COUNSELLOR', 'LEGAL_COUNSEL', 'MODERATOR'].includes(targetUser.userRole)) {
      return res.status(400).json({ error: 'Only counsellor, legal-counsel, and moderator accounts can be set active or inactive.' });
    }

    // Banned accounts must be restored via the dedicated unban endpoint, not the
    // active/inactive flip. This prevents silent bypass of ban reason/audit trail.
    if (targetUser.accountStatus === 'BANNED') {
      return res.status(400).json({ error: 'This account is banned. Use the unban action to restore access.' });
    }

    if (targetUser.userId === actor.userId && status === 'SUSPENDED') {
      return res.status(400).json({ error: 'You cannot set your own NGO admin account to inactive.' });
    }

    // Save the account lifecycle transition first, then record immutable audit trail.
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

/**
 * banUser
 * -------
 * PATCH /api/admin/ngo/users/:userId/ban
 *
 * Applies a BANNED lifecycle state to a target user account. Intended for
 * NGO admins acting on community members (survivors) or frontline staff
 * (counsellors, legal counsel) who have violated platform policies.
 *
 * Policy guardrails enforced here:
 *  - Only NGO_ADMIN callers may ban.
 *  - Only SURVIVOR, COUNSELLOR, and LEGAL_COUNSEL accounts may be targeted.
 *    Admin/staff-lifecycle accounts (NGO_ADMIN, MODERATOR) are never bannable.
 *  - Self-ban is explicitly rejected.
 *  - A ban reason is mandatory (reason is surfaced in audit records).
 *  - Optional banExpiresAt enables temporary bans; must be a future date.
 *    Null banExpiresAt means the ban is permanent until manually lifted.
 *
 * A dual audit trail is written:
 *  - ModerationActionLog (type: 'BAN') for moderation review workflows.
 *  - AuditLog (type: 'ACCOUNT_BANNED') which surfaces in System Admin logs.
 *
 * Known limitation: banning a COUNSELLOR or LEGAL_COUNSEL does NOT
 * automatically reassign their active survivor caseload. NGO admins should
 * use the staff reassignment workflow after banning a staff member.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function banUser(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const userId = String(req.params.userId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const rawExpiresAt = req.body?.expiresAt || null;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required.' });
    }

    // A reason is mandatory — this goes into both the ModerationActionLog and
    // the UserAccount.banReason for later admin review and audit.
    if (!reason) {
      return res.status(400).json({ error: 'A ban reason is required.' });
    }

    // Validate optional expiry date: if provided it must be in the future.
    // A past expiry date would instantly auto-lift the ban on next auth.
    let banExpiresAt = null;
    if (rawExpiresAt) {
      const parsedExpiry = new Date(rawExpiresAt);
      if (isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({ error: 'expiresAt must be a valid ISO date string.' });
      }
      if (parsedExpiry <= new Date()) {
        return res.status(400).json({ error: 'expiresAt must be a future date.' });
      }
      banExpiresAt = parsedExpiry;
    }

    const targetUser = await UserAccount.findByPk(userId, {
      attributes: ['userId', 'userRole', 'accountStatus']
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Admin accounts are never bannable — banning admins requires a full
    // deactivation workflow handled outside this endpoint.
    if (!BANNABLE_ROLES.includes(targetUser.userRole)) {
      return res.status(400).json({
        error: 'Only survivor and frontline staff accounts can be banned via this endpoint.'
      });
    }

    // Prevent self-ban — an NGO admin cannot lock themselves out.
    if (targetUser.userId === actor.userId) {
      return res.status(400).json({ error: 'You cannot ban your own account.' });
    }

    // Apply the ban — note that authMiddleware will enforce this on the very
    // next request the target user makes, even with an active session token.
    const now = new Date();
    targetUser.accountStatus = 'BANNED';
    targetUser.banReason = reason;
    targetUser.bannedAt = now;
    targetUser.banExpiresAt = banExpiresAt;
    targetUser.bannedByUserId = actor.userId;
    await targetUser.save();

    // Dual audit trail: moderation log (community moderation flows) +
    // AuditLog (surfaces in System Admin logs feed automatically).
    await Promise.all([
      ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: targetUser.userId,
        moderationActionType: 'BAN',
        moderationActionReason: reason
      }),
      AuditLog.create({
        auditId: randomUUID(),
        actorUserId: actor.userId,
        actionType: 'ACCOUNT_BANNED',
        targetEntity: `${targetUser.userRole}:${targetUser.userId}`
      })
    ]);

    // Force-revoke any live sockets immediately — banned users cannot continue
    // sessions beyond the current request/message without waiting for expiry.
    req.app.locals.io?.in(`user:${targetUser.userId}`).disconnectSockets(true);

    // For staff bans, cascade-reassign their active survivors to ensure continuity.
    if (['COUNSELLOR', 'LEGAL_COUNSEL'].includes(targetUser.userRole)) {
      setImmediate(() =>
        cascadeReassignOnStaffBan(targetUser.userId, targetUser.userRole, reason)
          .catch((err) => console.error('[banUser] cascade error:', err))
      );
    }

    return res.json({
      message: `Account banned successfully.${banExpiresAt ? ` Ban expires at ${banExpiresAt.toISOString()}.` : ' Ban is permanent until lifted.'}`,
      user: {
        userId: targetUser.userId,
        role: targetUser.userRole,
        accountStatus: 'BANNED',
        banReason: reason,
        bannedAt: now,
        banExpiresAt
      }
    });
  } catch (error) {
    console.error('banUser error:', error);
    return res.status(500).json({ error: 'Failed to apply ban.' });
  }
}

/**
 * unbanUser
 * ---------
 * PATCH /api/admin/ngo/users/:userId/unban
 *
 * Lifts a BANNED lifecycle state and restores the account to ACTIVE.
 * Clears all ban metadata fields and writes an audit trail.
 *
 * Can also be called on SUSPENDED accounts to restore them, but the
 * primary intended use is lifting BANNED status.
 *
 * Policy guardrails:
 *  - Only NGO_ADMIN callers may unban.
 *  - Self-unban is permitted (e.g. system admin accidentally banned a peer;
 *    the NGO admin cleans up their own mistake).
 *  - Unbanning an already-ACTIVE account is a no-op (returns 200).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function unbanUser(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'userId is required.' });
    }

    const targetUser = await UserAccount.findByPk(userId, {
      attributes: ['userId', 'userRole', 'accountStatus']
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Idempotent: already active accounts require no change.
    if (targetUser.accountStatus === 'ACTIVE') {
      return res.json({
        message: 'Account is already active.',
        user: { userId: targetUser.userId, accountStatus: 'ACTIVE' }
      });
    }

    // Restore the account and clear all ban metadata.
    targetUser.accountStatus = 'ACTIVE';
    targetUser.banReason = null;
    targetUser.bannedAt = null;
    targetUser.banExpiresAt = null;
    targetUser.bannedByUserId = null;
    await targetUser.save();

    // Dual audit trail mirrors the ban action.
    await Promise.all([
      ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: targetUser.userId,
        moderationActionType: 'UNBAN',
        moderationActionReason: 'Account ban lifted by NGO admin.'
      }),
      AuditLog.create({
        auditId: randomUUID(),
        actorUserId: actor.userId,
        actionType: 'ACCOUNT_UNBANNED',
        targetEntity: `${targetUser.userRole}:${targetUser.userId}`
      })
    ]);

    return res.json({
      message: 'Account ban lifted. Account is now active.',
      user: {
        userId: targetUser.userId,
        role: targetUser.userRole,
        accountStatus: 'ACTIVE'
      }
    });
  } catch (error) {
    console.error('unbanUser error:', error);
    return res.status(500).json({ error: 'Failed to lift ban.' });
  }
}

/**
 * loadMaintenanceStateFromDb
 * --------------------------
 * Reads the persisted maintenance setting from DB into the in-process cache.
 * Called once at server boot (after sequelize.sync) so maintenance mode
 * that was enabled before a restart is immediately enforced on startup.
 *
 * @returns {Promise<void>}
 */
async function loadMaintenanceStateFromDb() {
  try {
    const row = await SystemSetting.findByPk(MAINTENANCE_SETTING_KEY);
    if (row?.settingValue) {
      const parsed = JSON.parse(row.settingValue);
      _maintenanceCache = {
        enabled: Boolean(parsed.enabled),
        updatedAt: parsed.updatedAt || null,
        reason: parsed.reason || null,
        expectedUntil: parsed.expectedUntil || null
      };
      if (_maintenanceCache.enabled) {
        console.log('[maintenance] Restored enabled maintenance mode from DB.');
      }
    }
  } catch (err) {
    // Non-fatal: if the read fails (e.g. table not yet created on first boot)
    // the in-process default (disabled) is safe.
    console.warn('[maintenance] Could not load maintenance state from DB:', err.message);
  }
}

function getMaintenanceModeState() {
  // Shared helper used by the public-status endpoint and maintenance guard responses.
  return { ..._maintenanceCache };
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
  if (!_maintenanceCache.enabled) return next();

  // Permit minimal auth recovery paths so operators can sign in to disable
  // maintenance mode after being signed out. Signup-only endpoints
  // (request-otp, verify-otp, complete-signup) stay blocked so maintenance
  // windows cannot create fresh accounts while the system is restricted.
  const normalizedPath = String(req.path || '').toLowerCase();
  // Password sign-in remains available so NGO admins are never trapped.
  if (normalizedPath === '/api/auth/login-password') return next();
  // 2FA verification remains available to complete an in-progress signin.
  if (normalizedPath === '/api/auth/verify-2fa') return next();

  if (req.path === '/api/system/public-status') return next();
  if (req.path.startsWith('/api/admin')) return next();
  if (req.path.startsWith('/api/health')) return next();

  const role = getRoleFromAuthHeader(req);
  if (role === 'NGO_ADMIN') return next();

  return res.status(503).json({
    error: 'System is currently under maintenance. Please try again later.',
    maintenanceMode: getMaintenanceModeState()
  });
}

/**
 * cascadeReassignOnStaffBan
 * -------------------------
 * When a COUNSELLOR or LEGAL_COUNSEL is banned, auto-reassigns all of their
 * active survivors to the next least-loaded available staff member.
 *
 * Uses the same `applySurvivorReassignment` primitive as the manual NGO-admin
 * flow, so assignment history, chat channel resync, and workload recalculation
 * all fire automatically.
 *
 * If no replacement candidate exists (only one staff member in that role) the
 * survivor is left on the banned staff member's roster — the NGO admin will
 * need to handle it manually. This is logged but does not crash the ban.
 *
 * @param {string} bannedUserId - UserAccount.userId of the banned staff member.
 * @param {string} targetRole   - Canonical role string ('COUNSELLOR' or 'LEGAL_COUNSEL').
 * @param {string} reason       - Reason text propagated to StaffAssignmentHistory.
 * @returns {Promise<void>}
 */
async function cascadeReassignOnStaffBan(bannedUserId, targetRole, reason) {
  try {
    if (targetRole === 'COUNSELLOR') {
      const bannedProfile = await CounsellorProfile.findOne({
        where: { userId: bannedUserId },
        attributes: ['counsellorId']
      });
      if (!bannedProfile) return;

      const affectedSurvivors = await SurvivorProfile.findAll({
        where: { assignedCounsellorId: bannedProfile.counsellorId },
        attributes: ['survivorId', 'assignedCounsellorId']
      });

      if (affectedSurvivors.length === 0) return;

      // Pick replacement: AVAILABLE counsellor with lowest workload, excluding the banned one.
      const replacement = await getLeastLoadedStaff(CounsellorProfile, 'counsellorId', bannedProfile.counsellorId);
      const replacementId = replacement?.counsellorId || null;

      for (const survivor of affectedSurvivors) {
        if (!replacementId) {
          console.warn('[banCascade] No replacement counsellor found for survivor', survivor.survivorId);
          continue;
        }
        await applySurvivorReassignment({
          survivorId: survivor.survivorId,
          counsellorId: replacementId,
          legalCounselId: null,
          reason: `Auto-reassigned: assigned counsellor was banned. ${reason}`
        }).catch((err) =>
          console.error('[banCascade] counsellor reassignment failed for survivor', survivor.survivorId, err)
        );
      }
    } else if (targetRole === 'LEGAL_COUNSEL') {
      const bannedProfile = await LegalCounselProfile.findOne({
        where: { userId: bannedUserId },
        attributes: ['legalCounselId']
      });
      if (!bannedProfile) return;

      const affectedSurvivors = await SurvivorProfile.findAll({
        where: { assignedLegalCounselId: bannedProfile.legalCounselId },
        attributes: ['survivorId', 'assignedLegalCounselId']
      });

      if (affectedSurvivors.length === 0) return;

      const replacement = await getLeastLoadedStaff(LegalCounselProfile, 'legalCounselId', bannedProfile.legalCounselId);
      const replacementId = replacement?.legalCounselId || null;

      for (const survivor of affectedSurvivors) {
        if (!replacementId) {
          console.warn('[banCascade] No replacement legal counsel found for survivor', survivor.survivorId);
          continue;
        }
        await applySurvivorReassignment({
          survivorId: survivor.survivorId,
          counsellorId: null,
          legalCounselId: replacementId,
          reason: `Auto-reassigned: assigned legal counsel was banned. ${reason}`
        }).catch((err) =>
          console.error('[banCascade] legal counsel reassignment failed for survivor', survivor.survivorId, err)
        );
      }
    }
  } catch (err) {
    // Cascade failure is logged but must not prevent the ban itself from completing.
    console.error('[banCascade] cascadeReassignOnStaffBan error:', err);
  }
}

/**
 * listBannedUsers
 * ---------------
 * GET /api/admin/ngo/banned-users
 *
 * Returns all accounts currently in BANNED status, ordered by bannedAt DESC.
 * NGO_ADMIN only. Optional `?role=SURVIVOR|COUNSELLOR|LEGAL_COUNSEL` filter.
 *
 * Covers the gap where permanently-banned survivors are not discoverable in
 * the Staff Directory (which only shows staff) or Moderation Desk (which only
 * shows rows for reported content). This endpoint makes all banned accounts
 * available for review and one-click unban.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function listBannedUsers(req, res) {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    if (actor.role !== 'NGO_ADMIN') return roleForbidden(res, ['NGO_ADMIN']);

    const roleFilter = req.query.role ? String(req.query.role).toUpperCase() : null;

    const where = { accountStatus: 'BANNED' };
    if (roleFilter && BANNABLE_ROLES.includes(roleFilter)) {
      where.userRole = roleFilter;
    }

    const banned = await UserAccount.findAll({
      where,
      attributes: ['userId', 'userRole', 'phoneNumber', 'banReason', 'bannedAt', 'banExpiresAt', 'bannedByUserId', 'accountStatus'],
      order: [['bannedAt', 'DESC']]
    });

    return res.json({
      bannedUsers: banned.map((u) => ({
        userId: u.userId,
        role: u.userRole,
        phoneNumber: u.phoneNumber,
        banReason: u.banReason,
        bannedAt: u.bannedAt,
        banExpiresAt: u.banExpiresAt,
        bannedByUserId: u.bannedByUserId,
        isPermanent: !u.banExpiresAt
      })),
      total: banned.length
    });
  } catch (error) {
    console.error('listBannedUsers error:', error);
    return res.status(500).json({ error: 'Failed to fetch banned users.' });
  }
}

module.exports = {
  getNgoDashboard,
  globalSearch,
  setMaintenanceMode,
  createNgoResource,
  updateNgoResource,
  reassignSurvivor,
  getReassignmentSuggestions,
  createStaffAccount,
  updateStaffAccountStatus,
  banUser,
  unbanUser,
  listBannedUsers,
  applySurvivorReassignment,
  getMaintenanceModeState,
  loadMaintenanceStateFromDb,
  maintenanceGuard
};
