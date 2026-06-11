/**
 * chatController.js
 * -----------------
 * Handles fetching chat channels and retrieving historical direct messages.
 */

const {
  DirectChatChannel,
  DirectChatMessage,
  SurvivorProfile,
  UserAccount,
  CounsellorProfile,
  LegalCounselProfile
} = require('../models');
const { Op } = require('sequelize');
const {
  getActorContextByUserId,
  ensureAutoChannelsForSurvivor,
  canUserAccessChannel
} = require('../services/chatAccessService');

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * Returns active direct-chat channels for the authenticated user.
 *
 * Data-model note:
 * - `directChatChannel.survivorId` references SurvivorProfile.survivorId.
 * - JWT identity contains UserAccount.userId.
 * - For survivor users, we must resolve userId -> survivorProfile.survivorId
 *   before channel filtering. Staff users can match directly on
 *   supportStaffCounterpartId.
 */
const getChannels = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const actor = await getActorContextByUserId(userId);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    if (actor.role === 'SYSTEM_ADMIN' || actor.role === 'NGO_ADMIN') {
      return res.status(403).json({ error: 'Direct chat is available only for survivors and assigned support staff.' });
    }

    // If this account has a survivor profile, capture the survivor PK used by
    // directChatChannel. For non-survivor accounts this will be null.
    const survivorProfile = await SurvivorProfile.findOne({
      where: { userId },
      attributes: ['survivorId']
    });

    // Always include staff-side membership. Add survivor-side membership only
    // when a survivor profile exists for this authenticated account.
    const channelAudience = [{ supportStaffCounterpartId: userId }];
    if (survivorProfile?.survivorId) {
      // Survivor channels are auto-provisioned from assignment links.
      await ensureAutoChannelsForSurvivor(survivorProfile);
      channelAudience.push({ survivorId: survivorProfile.survivorId });
    }

    const includeArchived = String(req.query?.includeArchived || '').trim().toLowerCase() === 'true';
    // Survivors can optionally request archived channels to support restore/delete
    // actions, while staff continue to see active channels only.
    const visibleStatuses = includeArchived && actor.role === 'SURVIVOR'
      ? ['active', 'archived']
      : ['active'];

    // Return channels by membership and visibility status for sidebar rendering.
    const channels = await DirectChatChannel.findAll({
      where: {
        [Op.or]: channelAudience,
        chatChannelStatus: { [Op.in]: visibleStatuses }
      },
      order: [['chatCreationTimestamp', 'DESC']]
    });

    const counterpartUserIds = [...new Set(channels.map((channel) => channel.supportStaffCounterpartId))];
    const [counsellorPresence, legalPresence] = await Promise.all([
      CounsellorProfile.findAll({
        where: { userId: { [Op.in]: counterpartUserIds.length ? counterpartUserIds : ['__none__'] } },
        attributes: ['userId', 'availabilityStatus'],
        raw: true
      }),
      LegalCounselProfile.findAll({
        where: { userId: { [Op.in]: counterpartUserIds.length ? counterpartUserIds : ['__none__'] } },
        attributes: ['userId', 'availabilityStatus'],
        raw: true
      })
    ]);

    const availabilityByUserId = new Map([
      ...counsellorPresence.map((row) => [row.userId, row.availabilityStatus]),
      ...legalPresence.map((row) => [row.userId, row.availabilityStatus])
    ]);

    const enriched = await Promise.all(
      channels.map(async (channel) => {
        const unreadCount = await DirectChatMessage.count({
          where: {
            chatId: channel.chatId,
            messageReadStatus: 'UNREAD',
            senderUserId: { [Op.ne]: userId }
          }
        });

        const counterpart = await UserAccount.findByPk(channel.supportStaffCounterpartId, {
          attributes: ['userId', 'userRole']
        });

        return {
          ...channel.toJSON(),
          unreadCount,
          counterpartRole: counterpart?.userRole || null,
          // Staff availability is only meaningful to survivor-side viewers.
          counterpartAvailability:
            actor.role === 'SURVIVOR'
              ? availabilityByUserId.get(channel.supportStaffCounterpartId) || null
              : null,
          asyncDeliveryHint:
            actor.role === 'SURVIVOR' && availabilityByUserId.get(channel.supportStaffCounterpartId) === 'OFFLINE'
              ? 'Staff member is currently offline. Your messages will be delivered when they return.'
              : null
        };
      })
    );

    res.status(200).json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve chat channels.' });
  }
};

const updateChannelStatus = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const actor = await getActorContextByUserId(userId);
    if (!actor || actor.role !== 'SURVIVOR') {
      return res.status(403).json({ error: 'Only survivors can archive, restore, or delete direct chats.' });
    }

    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!['active', 'archived', 'deleted'].includes(nextStatus)) {
      return res.status(400).json({ error: 'status must be active, archived, or deleted.' });
    }

    const channel = await DirectChatChannel.findByPk(chatId);
    if (!channel) {
      return res.status(404).json({ error: 'Chat channel not found.' });
    }

    // Survivors can only mutate channels that belong to their own survivor profile.
    if (!actor.survivorId || channel.survivorId !== actor.survivorId) {
      return res.status(403).json({ error: 'Unauthorized for this chat channel.' });
    }

    if (channel.chatChannelStatus === 'deleted') {
      return res.status(400).json({ error: 'Deleted channels cannot be changed.' });
    }

    channel.chatChannelStatus = nextStatus;
    await channel.save();

    return res.json({
      message:
        nextStatus === 'archived'
          ? 'Chat archived successfully.'
          : nextStatus === 'deleted'
            ? 'Chat deleted successfully.'
            : 'Chat restored successfully.',
      channel: {
        chatId: channel.chatId,
        chatChannelStatus: channel.chatChannelStatus
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update chat channel status.' });
  }
};

/**
 * Returns message history for a specific channel when the authenticated user
 * is a valid participant (survivor side or staff side).
 */
const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const allowed = await canUserAccessChannel(userId, chatId);
    if (!allowed) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    // Messages are returned oldest -> newest so frontend can append live events
    // while preserving chronological order.
    const messages = await DirectChatMessage.findAll({
      where: { chatId },
      order: [['messageDispatchTimestamp', 'ASC']]
    });

    await DirectChatMessage.update(
      { messageReadStatus: 'READ' },
      {
        where: {
          chatId,
          senderUserId: { [Op.ne]: userId },
          messageReadStatus: 'UNREAD'
        }
      }
    );

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve message history.' });
  }
};

const markChannelRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = getUserIdFromRequest(req);

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const allowed = await canUserAccessChannel(userId, chatId);
    if (!allowed) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await DirectChatMessage.update(
      { messageReadStatus: 'READ' },
      {
        where: {
          chatId,
          senderUserId: { [Op.ne]: userId },
          messageReadStatus: 'UNREAD'
        }
      }
    );

    return res.json({ message: 'Messages marked as read.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark messages as read.' });
  }
};

module.exports = { getChannels, getMessages, markChannelRead, updateChannelStatus };