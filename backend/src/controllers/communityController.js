const { randomUUID } = require("crypto");
const {
  CommunityRoom,
  RoomMembership,
  CommunityMessage,
  HarmfulContentReport,
  ModerationActionLog,
  UserAccount,
  AuditLog,
  SurvivorProfile,
  ModeratorProfile,
  sequelize
} = require("../models");
const { normalizeRole, BANNABLE_ROLES } = require("../utils/roles");
const { createNotification } = require("../services/notificationService");
const { cascadeReassignOnStaffBan } = require("./adminController");

/**
 * Community controller
 *
 * Design notes:
 * - Survivors are represented with privacy-preserving display identities.
 * - Room reads/writes require membership checks to avoid silent data leakage.
 * - Moderation actions are logged for NGO-admin accountability.
 */

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

async function getActor(req) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId, {
    attributes: ["userId", "userRole", "accountStatus"]
  });

  if (!user || user.accountStatus !== "ACTIVE") return null;

  return {
    userId: user.userId,
    role: normalizeRole(user.userRole)
  };
}

/**
 * incrementModeratorWorkload
 * --------------------------
 * Bumps currentWorkloadScore on a moderator's profile after they take a
 * moderation action. Pure capacity-visibility counter — the report queue
 * stays a shared pull queue, so this never affects routing. No-op for
 * NGO_ADMIN actors (they have no moderatorProfile row).
 *
 * @param {string} userId
 * @param {import('sequelize').Transaction} [transaction]
 */
async function incrementModeratorWorkload(userId, transaction) {
  const profile = await ModeratorProfile.findOne({ where: { userId }, transaction });
  if (!profile) return;
  profile.currentWorkloadScore += 1;
  await profile.save({ transaction });
}

/**
 * getDisplayIdentity
 * ------------------
 * Returns privacy-safe display metadata for public community rendering.
 *
 * Survivors are pseudonymized while verified staff roles are shown with
 * explicit role badges.
 */
async function getDisplayIdentity(userId) {
  const user = await UserAccount.findByPk(userId, { attributes: ["userId", "userRole"] });
  if (!user) {
    return { displayName: "Community Member", role: "UNKNOWN", badge: null };
  }

  const role = normalizeRole(user.userRole);

  if (role === "SURVIVOR") {
    // Survivors keep a pseudonymous identity in public room timelines.
    const survivor = await SurvivorProfile.findOne({
      where: { userId: user.userId },
      attributes: ["displayNickname"]
    });

    return {
      displayName: survivor?.displayNickname || "Anonymous Survivor",
      role,
      badge: null
    };
  }

  if (role === "COUNSELLOR") {
    return { displayName: "Verified Counsellor", role, badge: "Verified Counsellor" };
  }

  if (role === "LEGAL_COUNSEL") {
    return { displayName: "Verified Legal Counsel", role, badge: "Verified Legal Counsel" };
  }

  if (role === "NGO_ADMIN") {
    return { displayName: "Verified NGO Administrator", role, badge: "Verified NGO Administrator" };
  }

  if (role === "MODERATOR") {
    return { displayName: "Verified Moderator", role, badge: "Verified Moderator" };
  }

  return { displayName: "Community Member", role, badge: null };
}

/**
 * ensureGeneralRoomExists
 * -----------------------
 * Seeds core community rooms if they do not exist yet.
 * Safe to call on every rooms-list request due idempotent name checks.
 */
async function ensureGeneralRoomExists() {
  // Keep default rooms idempotent so repeated requests cannot duplicate seeds.
  const defaultRooms = [
    {
      roomName: "General Support",
      roomDescriptionText: "A moderated peer-support room for day-to-day discussion."
    },
    {
      roomName: "Legal Guidance",
      roomDescriptionText: "Ask legal process questions and share verified legal resources."
    },
    {
      roomName: "Emotional Support",
      roomDescriptionText: "Check-ins, coping tips, and encouragement from the community."
    },
    {
      roomName: "Safety Planning",
      roomDescriptionText: "Discuss practical safety planning ideas in a moderated space."
    }
  ];

  const existingRooms = await CommunityRoom.findAll({ attributes: ["roomName"] });
  const existingNames = new Set(existingRooms.map((room) => room.roomName));

  for (const room of defaultRooms) {
    if (!existingNames.has(room.roomName)) {
      await CommunityRoom.create({
        roomId: randomUUID(),
        roomName: room.roomName,
        roomDescriptionText: room.roomDescriptionText,
        createdByAdminId: null
      });
    }
  }

  return CommunityRoom.findOne({ order: [["roomCreationTimestamp", "ASC"]] });
}

/**
 * seedDemoMessagesForRoom
 * -----------------------
 * Non-production helper that preloads starter messages in empty rooms.
 *
 * This improves early-stage demos and local development UX while keeping
 * production data paths untouched.
 */
async function seedDemoMessagesForRoom(roomId, userId) {
  if (process.env.NODE_ENV === "production") return;

  const existingCount = await CommunityMessage.count({ where: { roomId } });
  if (existingCount > 0) return;

  const demoLines = [
    "Welcome to the room. Share only what feels safe for you.",
    "If you are in immediate danger, use emergency services first.",
    "Small steps still count. You are not behind.",
    "If anyone needs legal guidance, ask and verified staff will respond.",
    "Grounding tip: name 5 things you can see around you.",
    "Hydration reminder: take a sip of water if you can.",
    "You can pause and return later. Your pace is valid.",
    "Safety planning can start with one trusted contact.",
    "If you need to step away quickly, use Quick Exit.",
    "Community rule: no personal attacks, no sharing private identifying details.",
    "If a post feels harmful, report it so moderators can review.",
    "Coping idea: short walk + slow breathing for 2 minutes.",
    "You can ask for practical resources in your county here.",
    "Take breaks while reading. Emotional fatigue is real.",
    "You are welcome here."
  ];

  await CommunityMessage.bulkCreate(
    demoLines.map((line) => ({
      communityMessageId: randomUUID(),
      roomId,
      senderUserId: userId,
      publicMessageContent: line
    }))
  );
}

/**
 * listRooms
 * ---------
 * Returns all community rooms plus actor membership and activity metadata.
 * Response is sorted by latest activity timestamp for consistent client ordering.
 */
async function listRooms(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  await ensureGeneralRoomExists();

  const rooms = await CommunityRoom.findAll({ order: [["roomCreationTimestamp", "ASC"]] });
  const memberships = await RoomMembership.findAll({ where: { userId: actor.userId } });
  const joinedIds = new Set(memberships.map((m) => m.roomId));

  const response = await Promise.all(
    rooms.map(async (room) => {
      const membersCount = await RoomMembership.count({ where: { roomId: room.roomId } });
      // Latest room activity drives room ordering in clients.
      const latestMessage = await CommunityMessage.findOne({
        where: { roomId: room.roomId },
        attributes: ["messageDispatchTimestamp"],
        order: [["messageDispatchTimestamp", "DESC"]]
      });

      return {
        ...room.toJSON(),
        joined: joinedIds.has(room.roomId),
        membersCount,
        latestMessageDispatchTimestamp: latestMessage?.messageDispatchTimestamp || null
      };
    })
  );

  // API guarantees newest-active room first for consistent UX across clients.
  response.sort((a, b) => {
    const aTime = Date.parse(a.latestMessageDispatchTimestamp || a.roomCreationTimestamp || 0);
    const bTime = Date.parse(b.latestMessageDispatchTimestamp || b.roomCreationTimestamp || 0);
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return res.json({ rooms: response });
}

/**
 * createRoom
 * ----------
 * NGO-admin-only endpoint for creating a new moderated community room.
 * Creator is auto-joined so moderation actions are immediately available.
 */
async function createRoom(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN") {
    return res.status(403).json({ error: "Only NGO admins can create community rooms." });
  }

  const roomName = String(req.body.roomName || "").trim();
  const roomDescriptionText = String(req.body.roomDescriptionText || "").trim();

  if (!roomName) {
    return res.status(400).json({ error: "roomName is required." });
  }

  const room = await CommunityRoom.create({
    roomId: randomUUID(),
    roomName,
    roomDescriptionText: roomDescriptionText || null,
    createdByAdminId: null
  });

  await RoomMembership.create({
    membershipId: randomUUID(),
    roomId: room.roomId,
    userId: actor.userId
  });

  return res.status(201).json({ room: room.toJSON() });
}

/**
 * joinRoom
 * --------
 * Idempotent membership endpoint for room participation.
 */
async function joinRoom(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const room = await CommunityRoom.findByPk(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  await RoomMembership.findOrCreate({
    where: {
      roomId: room.roomId,
      userId: actor.userId
    },
    defaults: {
      membershipId: randomUUID(),
      roomId: room.roomId,
      userId: actor.userId
    }
  });

  return res.json({ message: "Joined room successfully." });
}

/**
 * listMessages
 * ------------
 * Membership-gated message history endpoint.
 *
 * Also hydrates each message with a privacy-safe author identity object used
 * by community clients.
 */
async function listMessages(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const room = await CommunityRoom.findByPk(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  const isMember = await RoomMembership.findOne({
    where: { roomId: room.roomId, userId: actor.userId }
  });

  if (!isMember) {
    return res.status(403).json({ error: "Join this room first to view messages." });
  }

  // Non-production only: seed starter copy so empty rooms are still explorable.
  await seedDemoMessagesForRoom(room.roomId, actor.userId);

  const messages = await CommunityMessage.findAll({
    where: { roomId: room.roomId },
    order: [["messageDispatchTimestamp", "ASC"]]
  });

  const hydrated = await Promise.all(
    messages.map(async (message) => {
      const identity = await getDisplayIdentity(message.senderUserId);
      return {
        ...message.toJSON(),
        author: identity
      };
    })
  );

  return res.json({ messages: hydrated });
}

/**
 * postMessage
 * -----------
 * Creates a room message and emits real-time socket event to room subscribers.
 * Auto-joins actor to room on first post for simplified UX.
 */
async function postMessage(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const room = await CommunityRoom.findByPk(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  const content = String(req.body.content || "").trim();
  if (!content) {
    return res.status(400).json({ error: "Message content is required." });
  }

  // Auto-join on first post keeps UX simple while preserving membership gating.
  await RoomMembership.findOrCreate({
    where: {
      roomId: room.roomId,
      userId: actor.userId
    },
    defaults: {
      membershipId: randomUUID(),
      roomId: room.roomId,
      userId: actor.userId
    }
  });

  const message = await CommunityMessage.create({
    communityMessageId: randomUUID(),
    roomId: room.roomId,
    senderUserId: actor.userId,
    publicMessageContent: content
  });

  const author = await getDisplayIdentity(actor.userId);
  const responsePayload = { ...message.toJSON(), author };

  req.app.locals.io?.to(`community-room:${room.roomId}`).emit("community:new-message", {
    roomId: room.roomId,
    message: responsePayload
  });

  return res.status(201).json({ message: responsePayload });
}

/**
 * reportMessage
 * -------------
 * Files a harmful-content moderation report for a community message.
 * Self-reporting is blocked to keep moderation signals actionable.
 */
async function reportMessage(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const message = await CommunityMessage.findByPk(req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: "Message not found." });
  }

  // Users cannot report their own messages; this keeps moderation signals meaningful.
  if (message.senderUserId === actor.userId) {
    return res.status(400).json({ error: "You cannot report your own message." });
  }

  const reason = String(req.body.reason || "").trim();
  if (!reason) {
    return res.status(400).json({ error: "reason is required." });
  }

  const report = await HarmfulContentReport.create({
    contentReportId: randomUUID(),
    reportedCommunityMessageId: message.communityMessageId,
    reporterUserId: actor.userId,
    reportReasonText: reason,
    moderationReviewStatus: "PENDING"
  });

  req.app.locals.io?.to("community-moderation").emit("community:report-created", {
    reportId: report.contentReportId,
    roomId: message.roomId
  });

  return res.status(201).json({ report });
}

/**
 * deleteMessage
 * -------------
 * Allows message owners to delete their own posts.
 * NGO admins and moderators may also delete any message as a moderation action
 * (Community Chat oversight is part of the delegated Moderator scope).
 */
async function deleteMessage(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const message = await CommunityMessage.findByPk(req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: "Message not found." });
  }

  // Message owners can self-delete; NGO admins/moderators can moderate-delete.
  const isOwner = message.senderUserId === actor.userId;
  const isModerationStaff = actor.role === "NGO_ADMIN" || actor.role === "MODERATOR";

  if (!isOwner && !isModerationStaff) {
    return res.status(403).json({ error: "You can only delete your own messages." });
  }

  if (isModerationStaff && !isOwner) {
    // Admin deletions are audit-logged for moderation traceability.
    await ModerationActionLog.create({
      moderationActionId: randomUUID(),
      moderatorUserId: actor.userId,
      targetUserId: message.senderUserId,
      moderationActionType: "MESSAGE_DELETION",
      moderationActionReason: "Manual moderation deletion"
    });

    if (actor.role === "MODERATOR") {
      await incrementModeratorWorkload(actor.userId);
    }
  }

  await message.destroy();

  req.app.locals.io?.to(`community-room:${message.roomId}`).emit("community:message-deleted", {
    roomId: message.roomId,
    messageId: message.communityMessageId
  });

  return res.json({ message: "Message deleted." });
}

/**
 * getModerationReports
 * --------------------
 * Moderation queue endpoint — NGO admins and moderators (delegated scope).
 * Hydrates reports with message and identity context for moderation review UI.
 */
async function getModerationReports(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN" && actor.role !== "MODERATOR") {
    return res.status(403).json({ error: "Only NGO admins and moderators can access the moderation dashboard." });
  }

  const reports = await HarmfulContentReport.findAll({
    order: [["reportSubmissionTimestamp", "DESC"]]
  });

  const response = await Promise.all(
    reports.map(async (report) => {
      const message = await CommunityMessage.findByPk(report.reportedCommunityMessageId);
      const reporter = await getDisplayIdentity(report.reporterUserId);
      const author = message ? await getDisplayIdentity(message.senderUserId) : null;

      return {
        ...report.toJSON(),
        reportedMessage: message
          ? {
              communityMessageId: message.communityMessageId,
              roomId: message.roomId,
              publicMessageContent: message.publicMessageContent,
              author
            }
          : null,
        reporter
      };
    })
  );

  return res.json({ reports: response });
}

/**
 * reviewReport
 * ------------
 * Transactional moderation review endpoint.
 *
 * Within a single DB transaction it can:
 * - approve/reject report
 * - remove message (action: "remove_message")
 * - ban user     (action: "ban_user") — sets BANNED + ban metadata, writes BAN + ACCOUNT_BANNED
 *   audit entries, and resolves the report. body may supply `reason` (overrides report text)
 *   and optional `expiresAt` (ISO date string; must be a future date).
 * - issue warning notification (action: "issue_warning")
 * - persist moderation action logs
 *
 * Note: The legacy "suspend_user" and "block_user" actions have been removed.
 * Community moderation enforcement now goes through "ban_user" so all account
 * blocks carry reason/expiry metadata and a dual audit trail.
 */
async function reviewReport(req, res) {
  const transaction = await sequelize.transaction();

  try {

  const actor = await getActor(req);
  if (!actor) {
    await transaction.rollback();
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN" && actor.role !== "MODERATOR") {
    await transaction.rollback();
    return res.status(403).json({ error: "Only NGO admins and moderators can review reports." });
  }

  const report = await HarmfulContentReport.findByPk(req.params.reportId, { transaction });
  if (!report) {
    await transaction.rollback();
    return res.status(404).json({ error: "Report not found." });
  }

  const reviewStatus = String(req.body.reviewStatus || "").trim().toUpperCase();
  const action = String(req.body.action || "none").trim().toLowerCase();

  if (!["APPROVED", "REJECTED"].includes(reviewStatus)) {
    await transaction.rollback();
    return res.status(400).json({ error: "reviewStatus must be APPROVED or REJECTED." });
  }

  report.moderationReviewStatus = reviewStatus;
  report.reviewedAction = action;
  await report.save({ transaction });

  const message = await CommunityMessage.findByPk(report.reportedCommunityMessageId, { transaction });

  // Only approved reports can trigger moderation side-effects on users/messages.
  if (reviewStatus === "APPROVED" && message) {
    if (action === "remove_message") {
      message.publicMessageContent = "[Removed by moderators for community safety.]";
      await message.save({ transaction });

      await ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: message.senderUserId,
        moderationActionType: "MESSAGE_DELETION",
        moderationActionReason: report.reportReasonText
      }, { transaction });

      if (actor.role === "MODERATOR") {
        await incrementModeratorWorkload(actor.userId, transaction);
      }
    }

    if (action === "ban_user") {
      // Resolve ban metadata from the request body, falling back to the report text.
      const banReason = String(req.body.reason || report.reportReasonText || "").trim();
      const rawExpiresAt = req.body.expiresAt || null;

      // Validate expiresAt when supplied — must be a future date to be meaningful.
      let banExpiresAt = null;
      if (rawExpiresAt) {
        const parsed = new Date(rawExpiresAt);
        if (isNaN(parsed.getTime()) || parsed <= new Date()) {
          await transaction.rollback();
          return res.status(400).json({ error: "expiresAt must be a future date when provided." });
        }
        banExpiresAt = parsed;
      }

      // Fetch the full UserAccount row so we can check role and set ban metadata.
      const targetAccount = await UserAccount.findByPk(message.senderUserId, { transaction });

      // Enforce the same bannable-role policy as the admin ban endpoint — admin accounts
      // cannot be banned through the community moderation path either.
      if (targetAccount && !BANNABLE_ROLES.includes(targetAccount.userRole)) {
        await transaction.rollback();
        return res.status(400).json({ error: "Only survivor and frontline staff accounts can be banned." });
      }

      // Prevent self-ban through the moderation path.
      if (targetAccount && targetAccount.userId === actor.userId) {
        await transaction.rollback();
        return res.status(400).json({ error: "You cannot ban your own account." });
      }

      if (targetAccount) {
        // Apply BANNED lifecycle state with full metadata — parity with the
        // admin ban endpoint so mid-session enforcement and auto-lift behave identically.
        targetAccount.accountStatus = "BANNED";
        targetAccount.banReason = banReason;
        targetAccount.bannedAt = new Date();
        targetAccount.banExpiresAt = banExpiresAt;
        targetAccount.bannedByUserId = actor.userId;
        await targetAccount.save({ transaction });
      }

      // Dual audit trail: moderation log (visible in NGO desk history) + audit log
      // (general platform audit trail) — same convention as the admin ban endpoint.
      await ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: message.senderUserId,
        moderationActionType: "BAN",
        moderationActionReason: banReason
      }, { transaction });

      await AuditLog.create({
        auditId: randomUUID(),
        actorUserId: actor.userId,
        actionType: "ACCOUNT_BANNED",
        targetEntity: `${targetAccount?.userRole || "USER"}:${message.senderUserId}`
      }, { transaction });

      if (actor.role === "MODERATOR") {
        await incrementModeratorWorkload(actor.userId, transaction);
      }

      // Force-revoke live sockets immediately after committing the ban, and (for
      // frontline staff) cascade-reassign their survivors — same post-commit
      // side effects as the admin ban endpoint. Stashed on req since they must
      // run after transaction.commit().
      req._banTargetUserId = message.senderUserId;
      req._banTargetUserRole = targetAccount?.userRole || null;
      req._banReason = banReason;
    }

    if (action === "issue_warning") {
      await ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: message.senderUserId,
        moderationActionType: "WARNING",
        moderationActionReason: report.reportReasonText
      }, { transaction });

      // Warnings are stored as discreet in-app notifications so the target user
      // can be informed without exposing sensitive moderation context in plain UI text.
      // createNotification is called after commit to avoid transaction entanglement.
      req._warnTargetUserId = message.senderUserId;
      req._warnTargetRoomId = message.roomId;

      if (actor.role === "MODERATOR") {
        await incrementModeratorWorkload(actor.userId, transaction);
      }
    }
  }

  await transaction.commit();

  // Post-commit side-effects (socket push + cascade) run outside the transaction.
  if (req._banTargetUserId) {
    req.app.locals.io?.in(`user:${req._banTargetUserId}`).disconnectSockets(true);

    if (["COUNSELLOR", "LEGAL_COUNSEL"].includes(req._banTargetUserRole)) {
      setImmediate(() =>
        cascadeReassignOnStaffBan(req._banTargetUserId, req._banTargetUserRole, req._banReason)
          .catch((err) => console.error("[reviewReport] cascade error:", err))
      );
    }
  }

  if (req._warnTargetUserId) {
    createNotification({
      recipientUserId: req._warnTargetUserId,
      message: "A recent community post from your account was reviewed. Please follow community guidelines.",
      category: "MODERATION_ALERT",
      entityType: "COMMUNITY_ROOM",
      entityId: req._warnTargetRoomId
    }).catch((err) => console.error("[communityController] warning notification error:", err));
  }

  if (message) {
    req.app.locals.io?.to(`community-room:${message.roomId}`).emit("community:message-updated", {
      messageId: message.communityMessageId,
      roomId: message.roomId,
      publicMessageContent: message.publicMessageContent
    });
  }

  req.app.locals.io?.to("community-moderation").emit("community:report-reviewed", {
    reportId: report.contentReportId,
    reviewStatus: report.moderationReviewStatus
  });

    return res.json({ message: "Moderation review saved.", report });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    console.error("Community moderation review error:", error);
    return res.status(500).json({ error: "Failed to save moderation review." });
  }
}

module.exports = {
  listRooms,
  createRoom,
  joinRoom,
  listMessages,
  postMessage,
  reportMessage,
  deleteMessage,
  getModerationReports,
  reviewReport
};
