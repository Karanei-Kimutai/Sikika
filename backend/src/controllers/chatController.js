/**
 * chatController.js
 * -----------------
 * Handles fetching chat channels and retrieving historical direct messages.
 *
 * Presence integration:
 * - getChannels derives effective presence via presenceRegistry (real socket
 *   connectivity combined with the manual DB availabilityStatus).
 * - markChannelRead sets seenAt on newly-read messages and emits `message:seen`
 *   via app.locals.io so the sender's open chat UI shows Seen ticks immediately.
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
const presenceRegistry = require('../services/presenceRegistry');

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * updateChannelStatus
 * -------------------
 * Survivor-only endpoint for chat lifecycle actions.
 *
 * Allowed transitions:
 * - active -> archived
 * - archived -> active
 * - active/archived -> deleted
 *
 * Security notes:
 * - actor must be a survivor account
 * - actor can only mutate channels linked to their own survivor profile
 * - deleted channels are terminal and cannot be modified again
 */

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

        // Derive effective presence from real socket connectivity, layered on top of
        // the manual DB status. Staff may appear OFFLINE even if they set AVAILABLE
        // in their profile if they are not actually connected right now.
        const staffUserId = channel.supportStaffCounterpartId;
        const manualStatus = availabilityByUserId.get(staffUserId) || null;
        const effectivePresence = actor.role === 'SURVIVOR'
          ? presenceRegistry.getEffectivePresence(staffUserId, manualStatus)
          : null;

        return {
          ...channel.toJSON(),
          unreadCount,
          counterpartRole: counterpart?.userRole || null,
          // Effective presence is only meaningful on the survivor side of the channel.
          counterpartAvailability: effectivePresence,
          // Async copy nudges the survivor to send even if staff is offline.
          asyncDeliveryHint:
            effectivePresence === 'OFFLINE'
              ? 'Your support worker is currently offline. Your messages will be delivered when they return.'
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

/**
 * markChannelRead
 * ---------------
 * Marks all unread messages in a channel as READ for the authenticated actor.
 *
 * This powers unread badge clearing on the chat list when a channel is opened.
 */
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

    const now = new Date();

    // Find the UNREAD messages sent by the counterpart (not this user) before marking them.
    // We need their IDs to emit a targeted seen event to the sender.
    const unreadMessages = await DirectChatMessage.findAll({
      where: {
        chatId,
        senderUserId: { [Op.ne]: userId },
        messageReadStatus: 'UNREAD'
      },
      attributes: ['messageId', 'senderUserId']
    });

    if (unreadMessages.length > 0) {
      const messageIds = unreadMessages.map((m) => m.messageId);

      // Atomically flip to READ and set seenAt timestamp.
      await DirectChatMessage.update(
        { messageReadStatus: 'READ', seenAt: now },
        { where: { messageId: { [Op.in]: messageIds } } }
      );

      // Push a seen event so the original sender's chat view can flip ticks to Seen
      // without waiting for a page reload. We target the channel room and the sender's
      // personal room so multi-tab senders all receive the update.
      const io = req.app.locals.io;
      if (io) {
        const seenPayload = { chatId, messageIds, seenAt: now };
        io.to(chatId).emit('message:seen', seenPayload);

        // Deduplicate senderUserIds and target their personal rooms too.
        const senderIds = [...new Set(unreadMessages.map((m) => m.senderUserId))];
        for (const senderId of senderIds) {
          io.to(`user:${senderId}`).emit('message:seen', seenPayload);
        }
      }
    }

    // Read operations are idempotent so clients can safely call this on view open.
    return res.json({ message: 'Messages marked as read.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark messages as read.' });
  }
};

module.exports = { getChannels, getMessages, markChannelRead, updateChannelStatus };