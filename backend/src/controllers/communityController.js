const { randomUUID } = require("crypto");
const {
  CommunityRoom,
  RoomMembership,
  CommunityMessage,
  HarmfulContentReport,
  ModerationActionLog,
  UserAccount,
  SurvivorProfile
} = require("../models");

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

function normalizeRole(value) {
  const role = String(value || "").trim().toUpperCase();
  if (role === "LEGALCOUNSEL") return "LEGAL_COUNSEL";
  if (role === "NGOADMIN") return "NGO_ADMIN";
  if (role === "SYSTEMADMIN") return "SYSTEM_ADMIN";
  return role;
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

async function getDisplayIdentity(userId) {
  const user = await UserAccount.findByPk(userId, { attributes: ["userId", "userRole"] });
  if (!user) {
    return { displayName: "Community Member", role: "UNKNOWN", badge: null };
  }

  const role = normalizeRole(user.userRole);

  if (role === "SURVIVOR") {
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

  return { displayName: "Community Member", role, badge: null };
}

async function ensureGeneralRoomExists() {
  const existing = await CommunityRoom.findOne();
  if (existing) return existing;

  return CommunityRoom.create({
    roomId: randomUUID(),
    roomName: "General Support",
    roomDescriptionText: "A moderated peer-support room for day-to-day discussion.",
    createdByAdminId: null
  });
}

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
      return {
        ...room.toJSON(),
        joined: joinedIds.has(room.roomId),
        membersCount
      };
    })
  );

  return res.json({ rooms: response });
}

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

async function reportMessage(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const message = await CommunityMessage.findByPk(req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: "Message not found." });
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

async function getModerationReports(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN") {
    return res.status(403).json({ error: "Only NGO admins can access moderation dashboard." });
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

async function reviewReport(req, res) {
  const actor = await getActor(req);
  if (!actor) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (actor.role !== "NGO_ADMIN") {
    return res.status(403).json({ error: "Only NGO admins can review reports." });
  }

  const report = await HarmfulContentReport.findByPk(req.params.reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found." });
  }

  const reviewStatus = String(req.body.reviewStatus || "").trim().toUpperCase();
  const action = String(req.body.action || "none").trim().toLowerCase();

  if (!["APPROVED", "REJECTED"].includes(reviewStatus)) {
    return res.status(400).json({ error: "reviewStatus must be APPROVED or REJECTED." });
  }

  report.moderationReviewStatus = reviewStatus;
  await report.save();

  const message = await CommunityMessage.findByPk(report.reportedCommunityMessageId);

  if (reviewStatus === "APPROVED" && message) {
    if (action === "remove_message") {
      message.publicMessageContent = "[Removed by moderators for community safety.]";
      await message.save();

      await ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: message.senderUserId,
        moderationActionType: "MESSAGE_DELETION",
        moderationActionReason: report.reportReasonText
      });
    }

    if (action === "suspend_user") {
      await UserAccount.update(
        { accountStatus: "SUSPENDED" },
        { where: { userId: message.senderUserId } }
      );

      await ModerationActionLog.create({
        moderationActionId: randomUUID(),
        moderatorUserId: actor.userId,
        targetUserId: message.senderUserId,
        moderationActionType: "SUSPENSION",
        moderationActionReason: report.reportReasonText
      });
    }
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
}

module.exports = {
  listRooms,
  createRoom,
  joinRoom,
  listMessages,
  postMessage,
  reportMessage,
  getModerationReports,
  reviewReport
};
