const { randomUUID } = require("crypto");
const { Op } = require("sequelize");
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

/**
 * Resolves a full actor context object for the given UserAccount UUID.
 *
 * The context includes the user's normalized role and their corresponding
 * role-profile PK (survivorId, counsellorId, or legalCounselId), so callers
 * can perform ownership checks without additional profile queries.
 *
 * @param {string|null} userId - UserAccount.userId from the JWT.
 * @returns {Promise<{
 *   userId: string,
 *   role: string,
 *   survivorId: string|null,
 *   counsellorId: string|null,
 *   legalCounselId: string|null
 * }|null>} null if the userId is falsy or no matching account exists.
 */
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

/**
 * Idempotently provisions the two direct-chat channels every survivor should have:
 * one with their assigned counsellor and one with their assigned legal counsel.
 *
 * Uses Sequelize `findOrCreate` so repeated calls are safe — no duplicate channels
 * are created. Called at signup (authController) and on every `GET /api/chat/channels`
 * request so channels appear automatically after an assignment change.
 *
 * @param {import('../models/survivorProfile')} survivorProfile - A SurvivorProfile instance
 *   with at least survivorId, assignedCounsellorId, and assignedLegalCounselId.
 * @param {import('sequelize').Transaction} [transaction] - An existing transaction to run
 *   inside (e.g. so signup completion can commit/rollback channel provisioning together with
 *   the password write and profile creation). When omitted, calls run outside any transaction.
 * @returns {Promise<import('../models/directChatChannel')[]>} Array of found-or-created channels.
 */
async function ensureAutoChannelsForSurvivor(survivorProfile, transaction) {
  if (!survivorProfile?.survivorId) return [];

  const createdOrFound = [];

  if (survivorProfile.assignedCounsellorId) {
    // Auto-provision counsellor channel from assignment if missing.
    const assignedCounsellor = await CounsellorProfile.findByPk(survivorProfile.assignedCounsellorId, { transaction });
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
        },
        transaction
      });
      createdOrFound.push(channel);
    }
  }

  if (survivorProfile.assignedLegalCounselId) {
    // Auto-provision legal counsel channel from assignment if missing.
    // Note: channel type must be "legal_counsel_channel" to match model/frontend convention.
    const assignedLegal = await LegalCounselProfile.findByPk(survivorProfile.assignedLegalCounselId, { transaction });
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
        },
        transaction
      });
      createdOrFound.push(channel);
    }
  }

  return createdOrFound;
}

/**
 * Returns true when the given user is a valid participant in the specified channel
 * and the channel is not in a deleted state.
 *
 * Access rules:
 * - SURVIVOR: must own the channel via survivorId (their profile's PK).
 * - COUNSELLOR / LEGAL_COUNSEL: must be the supportStaffCounterpartId on the channel.
 * - NGO_ADMIN / MODERATOR / unknown: always denied (no direct-chat access).
 * - Deleted channels are intentionally inaccessible; archived channels remain readable
 *   so survivors can restore them via the Trash view.
 *
 * @param {string} userId  - UserAccount.userId of the requester.
 * @param {string} chatId  - DirectChatChannel.chatId to check access for.
 * @returns {Promise<boolean>}
 */
async function canUserAccessChannel(userId, chatId) {
  const actor = await getActorContextByUserId(userId);
  if (!actor) return false;

  const channel = await DirectChatChannel.findByPk(chatId);
  // Deleted channels are intentionally inaccessible. Archived channels remain
  // viewable for survivor restore workflows, while send-path still checks for
  // active status in socket handlers.
  if (!channel || channel.chatChannelStatus === "deleted") return false;

  if (actor.role === "SURVIVOR") {
    return Boolean(actor.survivorId && actor.survivorId === channel.survivorId);
  }

  if (actor.role === "COUNSELLOR" || actor.role === "LEGAL_COUNSEL") {
    return channel.supportStaffCounterpartId === actor.userId;
  }

  return false;
}

/**
 * Finds all active direct-chat channels a user participates in, on either
 * side (survivor or staff counterpart). Used to fan out events (e.g. "my
 * public key is now available") to every counterpart this user chats with.
 *
 * @param {string} userId - UserAccount.userId.
 * @returns {Promise<import('../models').DirectChatChannel[]>}
 */
async function getChannelsForParticipant(userId) {
  if (!userId) return [];

  const survivor = await SurvivorProfile.findOne({ where: { userId }, attributes: ["survivorId"] });

  const audience = [{ supportStaffCounterpartId: userId }];
  if (survivor?.survivorId) {
    audience.push({ survivorId: survivor.survivorId });
  }

  return DirectChatChannel.findAll({
    where: {
      [Op.or]: audience,
      chatChannelStatus: "active"
    }
  });
}

/**
 * Returns the UserAccount.userId values for both participants in a channel.
 *
 * The staff participant's userId is already stored as supportStaffCounterpartId.
 * The survivor's userId must be resolved by looking up their SurvivorProfile,
 * since the channel stores survivorId (SurvivorProfile.survivorId), not userId.
 *
 * Used by `notifyCounterpartsKeyAvailable` (chatController) and chatSocket to
 * fan out events to all participants of a channel.
 *
 * @param {import('../models/directChatChannel')} channel - A DirectChatChannel instance.
 * @returns {Promise<string[]>} Deduplicated array of up to two UserAccount.userId values.
 */
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
  getChannelParticipantUserIds,
  getChannelsForParticipant
};
