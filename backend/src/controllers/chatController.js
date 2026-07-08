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
  canUserAccessChannel,
  getChannelsForParticipant,
  getChannelParticipantUserIds
} = require('../services/chatAccessService');
const presenceRegistry = require('../services/presenceRegistry');

/**
 * Extracts the authenticated user's UUID from authMiddleware-attached JWT claims.
 * The payload carries both 'userId' and 'id' for backward compatibility.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * updateChannelStatus
 * -------------------
 * Survivor-only endpoint for chat lifecycle actions.
 *
 * Allowed transitions:
 * - active   → archived
 * - archived → active   (restore)
 * - active   → deleted
 * - archived → deleted
 * - deleted  → active   (restore from Trash — previously blocked; now allowed)
 *
 * "deleted → active" is intentionally allowed so survivors can recover contact
 * with their assigned counsellor/legal counsel after accidentally deleting a thread
 * (the Trash/Restore UX, Item 2). Other transitions out of deleted remain blocked.
 *
 * Security notes:
 * - actor must be a survivor account
 * - actor can only mutate channels linked to their own survivor profile
 * - canUserAccessChannel rejects deleted channels, so we authorize by direct
 *   survivorId ownership in this handler instead of using that helper
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

    if (actor.role === 'NGO_ADMIN' || actor.role === 'MODERATOR') {
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
    const includeDeleted  = String(req.query?.includeDeleted  || '').trim().toLowerCase() === 'true';

    // Visibility matrix (survivors only; staff always see active channels):
    //   default (no params)              → ['active']
    //   includeArchived=true             → ['active', 'archived']
    //   includeDeleted=true              → ['deleted']  (Trash view — deliberately excluded from active+archived)
    //   includeArchived=true + includeDeleted=true → ['active', 'archived', 'deleted']
    // Only survivors may view archived or deleted channels. Staff always see active only
    // to prevent accidental exposure of deleted threads on the staff side.
    let visibleStatuses;
    if (actor.role === 'SURVIVOR') {
      if (includeDeleted && includeArchived) {
        visibleStatuses = ['active', 'archived', 'deleted'];
      } else if (includeDeleted) {
        visibleStatuses = ['deleted'];
      } else if (includeArchived) {
        visibleStatuses = ['active', 'archived'];
      } else {
        visibleStatuses = ['active'];
      }
    } else {
      // COUNSELLOR / LEGAL_COUNSEL — always active only; deleted channels must not leak.
      visibleStatuses = ['active'];
    }

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

    // E2EE key exchange needs the *other* party's UserAccount.userId regardless
    // of which side is viewing. Survivor-side channels already carry it
    // (supportStaffCounterpartId); staff-side channels only carry survivorId
    // (a SurvivorProfile PK), so resolve those to UserAccount.userId here.
    const survivorIds = [...new Set(channels.map((channel) => channel.survivorId))];
    const survivorUserIdBySurvivorId = new Map(
      (await Promise.all(
        survivorIds.map((survivorId) =>
          SurvivorProfile.findByPk(survivorId, { attributes: ['survivorId', 'userId'] })
        )
      ))
        .filter(Boolean)
        .map((row) => [row.survivorId, row.userId])
    );

    const enriched = await Promise.all(
      channels.map(async (channel) => {
        const unreadCount = await DirectChatMessage.count({
          where: {
            chatId: channel.chatId,
            messageReadStatus: 'UNREAD',
            senderUserId: { [Op.ne]: userId }
          }
        });

        // Latest activity drives sidebar ordering (most recent conversation
        // first); channels with no messages yet fall back to creation time.
        const latestMessage = await DirectChatMessage.findOne({
          where: { chatId: channel.chatId },
          order: [['messageDispatchTimestamp', 'DESC']],
          attributes: ['messageDispatchTimestamp']
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

        const counterpartUserId = actor.role === 'SURVIVOR'
          ? channel.supportStaffCounterpartId
          : survivorUserIdBySurvivorId.get(channel.survivorId) || null;

        return {
          ...channel.toJSON(),
          unreadCount,
          // Timestamp of the newest message in this channel (null when empty);
          // clients keep this fresh via the `channel:activity` socket event.
          lastMessageAt: latestMessage?.messageDispatchTimestamp || null,
          counterpartRole: counterpart?.userRole || null,
          // UserAccount.userId of the other participant, used by the frontend to
          // fetch their ECDH public key and derive the per-channel E2EE key.
          counterpartUserId,
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

    // Most recently active conversation first — mirrors messenger-style
    // sidebars. The SQL-level chatCreationTimestamp ordering above is only
    // the tiebreak for channels that have no messages yet.
    enriched.sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.chatCreationTimestamp) -
        new Date(a.lastMessageAt || a.chatCreationTimestamp)
    );

    res.status(200).json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve chat channels.' });
  }
};

/**
 * Returns another user's ECDH public key so the requesting client can derive
 * a shared E2EE key for a direct-chat channel. Public keys are not sensitive
 * by design, so any authenticated user may look up any other user's key.
 */
const getPublicKey = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await UserAccount.findByPk(userId, { attributes: ['userId', 'ecdhPublicKey'] });
    if (!user || !user.ecdhPublicKey) {
      return res.status(404).json({ error: 'Public key not found for this user.' });
    }
    return res.status(200).json({ userId: user.userId, ecdhPublicKey: user.ecdhPublicKey });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve public key.' });
  }
};

/**
 * Validates that a serialized JWK is a supported ECDH P-256 public key.
 *
 * @param {string} jwkString
 * @returns {boolean}
 */
const isValidEcdhPublicJwk = (jwkString) => {
  if (typeof jwkString !== 'string') return false;

  try {
    const parsed = JSON.parse(jwkString);
    if (!parsed || typeof parsed !== 'object') return false;

    // Keep acceptance narrow to avoid storing malformed keys that later break
    // counterpart key import/derivation in the browser.
    const hasValidCoordinates = typeof parsed.x === 'string' && typeof parsed.y === 'string';
    return parsed.kty === 'EC' && parsed.crv === 'P-256' && hasValidCoordinates;
  } catch {
    return false;
  }
};

/**
 * notifyCounterpartsKeyAvailable
 * ------------------------------
 * Pushes a `chatKey:available` event to every channel counterpart of the
 * given user, so an open Direct Chat tab can immediately re-attempt E2EE
 * key derivation instead of waiting on its polling fallback. Mirrors the
 * `user:<userId>` personal-room broadcast pattern already used for presence
 * and read-receipt events in chatSocket.js / markChannelRead.
 *
 * @param {import('express').Request} req
 * @param {string} userId - The user whose public key was just registered.
 */
async function notifyCounterpartsKeyAvailable(req, userId) {
  try {
    const io = req.app.locals.io;
    if (!io) return;

    const channels = await getChannelsForParticipant(userId);
    for (const channel of channels) {
      const participantIds = await getChannelParticipantUserIds(channel);
      const counterpartIds = participantIds.filter((id) => id && id !== userId);
      for (const counterpartId of counterpartIds) {
        io.to(`user:${counterpartId}`).emit('chatKey:available', { chatId: channel.chatId, userId });
      }
    }
  } catch (error) {
    console.error('notifyCounterpartsKeyAvailable error:', error);
  }
}

/**
 * Registers the authenticated user's ECDH public key (JWK JSON string).
 * Called by the frontend on every authenticated app load so a counterpart
 * can always derive a fresh shared key. Idempotent.
 */
const setPublicKey = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const ecdhPublicKey = req.body?.ecdhPublicKey;
    if (typeof ecdhPublicKey !== 'string' || !ecdhPublicKey.trim()) {
      return res.status(400).json({ error: 'ecdhPublicKey must be a non-empty string.' });
    }

    if (!isValidEcdhPublicJwk(ecdhPublicKey)) {
      return res.status(400).json({ error: 'ecdhPublicKey must be a valid ECDH P-256 public JWK string.' });
    }

    await UserAccount.update({ ecdhPublicKey }, { where: { userId } });

    // Best-effort push so any counterpart with the chat open (and pending
    // queued messages) can flush them immediately rather than waiting on
    // their 30s polling fallback.
    await notifyCounterpartsKeyAvailable(req, userId);

    return res.status(200).json({ message: 'Public key registered.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to register public key.' });
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

    // Deleted channels may only transition to 'active' (restore from Trash).
    // All other transitions out of 'deleted' are blocked to prevent ambiguous states.
    if (channel.chatChannelStatus === 'deleted' && nextStatus !== 'active') {
      return res.status(400).json({
        error: 'Deleted channels can only be restored to active. Other transitions are not permitted.'
      });
    }

    channel.chatChannelStatus = nextStatus;
    await channel.save();

    const message =
      nextStatus === 'archived' ? 'Chat archived successfully.' :
      nextStatus === 'deleted'  ? 'Chat moved to Trash.' :
                                  'Chat restored successfully.';

    return res.json({
      message,
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

module.exports = { getChannels, getMessages, markChannelRead, updateChannelStatus, getPublicKey, setPublicKey };