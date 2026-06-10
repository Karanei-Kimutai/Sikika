/**
 * chatController.js
 * -----------------
 * Handles fetching chat channels and retrieving historical direct messages.
 */

const { DirectChatChannel, DirectChatMessage, SurvivorProfile, UserAccount } = require('../models');
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

    // Return only currently active channels for chat list rendering.
    const channels = await DirectChatChannel.findAll({
      where: {
        [Op.or]: channelAudience,
        chatChannelStatus: 'active'
      },
      order: [['chatCreationTimestamp', 'DESC']]
    });

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
          counterpartRole: counterpart?.userRole || null
        };
      })
    );

    res.status(200).json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve chat channels.' });
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

module.exports = { getChannels, getMessages, markChannelRead };