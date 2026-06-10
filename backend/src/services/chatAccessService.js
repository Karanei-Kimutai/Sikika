const { randomUUID } = require("crypto");
const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  DirectChatChannel
} = require("../models");

function normalizeRole(value) {
  const role = String(value || "").trim().toUpperCase();
  if (role === "LEGALCOUNSEL") return "LEGAL_COUNSEL";
  if (role === "NGOADMIN") return "NGO_ADMIN";
  if (role === "SYSTEMADMIN") return "SYSTEM_ADMIN";
  return role;
}

async function getActorContextByUserId(userId) {
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId);
  if (!user) return null;

  const role = normalizeRole(user.userRole || user.role);
  const actor = {
    userId: user.userId,
    role,
    survivorId: null,
    counsellorId: null,
    legalCounselId: null
  };

  if (role === "SURVIVOR") {
    const survivor = await SurvivorProfile.findOne({ where: { userId: user.userId } });
    actor.survivorId = survivor?.survivorId || null;
  }

  if (role === "COUNSELLOR") {
    const counsellor = await CounsellorProfile.findOne({ where: { userId: user.userId } });
    actor.counsellorId = counsellor?.counsellorId || null;
  }

  if (role === "LEGAL_COUNSEL") {
    const legal = await LegalCounselProfile.findOne({ where: { userId: user.userId } });
    actor.legalCounselId = legal?.legalCounselId || null;
  }

  return actor;
}

async function ensureAutoChannelsForSurvivor(survivorProfile) {
  if (!survivorProfile?.survivorId) return [];

  const createdOrFound = [];

  if (survivorProfile.assignedCounsellorId) {
    const assignedCounsellor = await CounsellorProfile.findByPk(survivorProfile.assignedCounsellorId);
    if (assignedCounsellor?.userId) {
      const [channel] = await DirectChatChannel.findOrCreate({
        where: {
          survivorId: survivorProfile.survivorId,
          supportStaffCounterpartId: assignedCounsellor.userId,
          chatChannelType: "counsellor_channel"
        },
        defaults: {
          chatId: randomUUID(),
          survivorId: survivorProfile.survivorId,
          supportStaffCounterpartId: assignedCounsellor.userId,
          chatChannelType: "counsellor_channel",
          chatChannelStatus: "active"
        }
      });
      createdOrFound.push(channel);
    }
  }

  if (survivorProfile.assignedLegalCounselId) {
    const assignedLegal = await LegalCounselProfile.findByPk(survivorProfile.assignedLegalCounselId);
    if (assignedLegal?.userId) {
      const [channel] = await DirectChatChannel.findOrCreate({
        where: {
          survivorId: survivorProfile.survivorId,
          supportStaffCounterpartId: assignedLegal.userId,
          chatChannelType: "legal_counsel_channel"
        },
        defaults: {
          chatId: randomUUID(),
          survivorId: survivorProfile.survivorId,
          supportStaffCounterpartId: assignedLegal.userId,
          chatChannelType: "legal_counsel_channel",
          chatChannelStatus: "active"
        }
      });
      createdOrFound.push(channel);
    }
  }

  return createdOrFound;
}

async function canUserAccessChannel(userId, chatId) {
  const actor = await getActorContextByUserId(userId);
  if (!actor) return false;

  const channel = await DirectChatChannel.findByPk(chatId);
  if (!channel || channel.chatChannelStatus !== "active") return false;

  if (actor.role === "SYSTEM_ADMIN") return false;

  if (actor.role === "SURVIVOR") {
    return Boolean(actor.survivorId && actor.survivorId === channel.survivorId);
  }

  if (actor.role === "COUNSELLOR" || actor.role === "LEGAL_COUNSEL") {
    return channel.supportStaffCounterpartId === actor.userId;
  }

  return false;
}

async function getChannelParticipantUserIds(channel) {
  const ids = new Set();
  if (!channel) return [];

  ids.add(channel.supportStaffCounterpartId);

  const survivor = await SurvivorProfile.findByPk(channel.survivorId, { attributes: ["userId"] });
  if (survivor?.userId) {
    ids.add(survivor.userId);
  }

  return [...ids];
}

module.exports = {
  getActorContextByUserId,
  ensureAutoChannelsForSurvivor,
  canUserAccessChannel,
  getChannelParticipantUserIds
};
