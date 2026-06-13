const { randomUUID } = require("crypto");
const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  DirectChatChannel
} = require("../models");

/**
 * chatAccessService
 * -----------------
 * Central access-control helper for direct chat features.
 *
 * Why this exists:
 * - keeps role normalization and actor resolution in one place
 * - ensures survivor/staff channel access rules are shared across controllers
 * - provisions assignment-driven channels idempotently
 */

const { normalizeRole } = require("../utils/roles");

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
    // Auto-provision counsellor channel from assignment if missing.
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
    // Auto-provision legal counsel channel from assignment if missing.
    // Note: channel type must be "legal_counsel_channel" to match model/frontend convention.
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
  // Deleted channels are intentionally inaccessible. Archived channels remain
  // viewable for survivor restore workflows, while send-path still checks for
  // active status in socket handlers.
  if (!channel || channel.chatChannelStatus === "deleted") return false;

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
