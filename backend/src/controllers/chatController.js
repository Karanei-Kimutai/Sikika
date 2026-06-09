/**
 * chatController.js
 * -----------------
 * Handles fetching chat channels and retrieving historical direct messages.
 */

const { DirectChatChannel, DirectChatMessage, SurvivorProfile } = require('../models');
const { Op } = require('sequelize');

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
    // Accept both token claim shapes for backward compatibility.
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
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
    res.status(200).json(channels);
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
    // Accept both token claim shapes for backward compatibility.
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    // Resolve survivor profile ID for survivor-side authorization checks.
    const survivorProfile = await SurvivorProfile.findOne({
      where: { userId },
      attributes: ['survivorId']
    });
    
    const channel = await DirectChatChannel.findOne({ where: { chatId } });

    // Survivor membership compares channel.survivorId against the resolved
    // survivor profile primary key, not against userAccount.userId.
    const isSurvivorInChannel = Boolean(
      survivorProfile?.survivorId && channel?.survivorId === survivorProfile.survivorId
    );
    // Staff membership is direct because channel stores userAccount.userId.
    const isStaffInChannel = channel?.supportStaffCounterpartId === userId;

    if (!channel || (!isSurvivorInChannel && !isStaffInChannel)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    // Messages are returned oldest -> newest so frontend can append live events
    // while preserving chronological order.
    const messages = await DirectChatMessage.findAll({
      where: { chatId },
      order: [['messageDispatchTimestamp', 'ASC']]
    });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve message history.' });
  }
};

module.exports = { getChannels, getMessages };