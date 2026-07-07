/**
 * chatSocket.js
 * -------------
 * Handles real-time WebSocket connections for the Direct Chat module.
 * Blindly stores and relays encrypted payloads.
 *
 * Security enforcements applied here:
 *  - JWT signature verified on connection.
 *  - accountStatus checked against DB on connect AND on every send event,
 *    so that a ban applied after connection establishment takes effect
 *    on the next message attempt (no need to disconnect all sockets on ban).
 *  - Channel membership verified on join and send.
 *
 * Presence integration:
 *  - presenceRegistry tracks connected sockets per userId.
 *  - On connect: join a per-user room `user:<userId>` so presence events and
 *    delivery receipts can be pushed to all of a user's open tabs at once.
 *  - On connect (staff): broadcast `presence:update` to affected survivors and
 *    run a delivery catch-up for messages received while offline.
 *  - On disconnect: update registry and re-broadcast presence if fully offline.
 *  - On sendEncryptedMessage: if the counterpart is online, mark deliveredAt now.
 */

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const {
  DirectChatMessage,
  DirectChatChannel,
  SurvivorProfile
} = require('../models');
const { canUserAccessChannel, getChannelParticipantUserIds } = require('../services/chatAccessService');
const presenceRegistry = require('../services/presenceRegistry');
const { createNotificationsBulk } = require('../services/notificationService');
const {
  getTokenFromHandshake,
  resolveUserIdFromTokenClaims,
  isUserAccountActive
} = require('../services/socketAuthService');

/**
 * Trust boundary notes:
 * - Token signature verification is required before socket joins are accepted.
 * - Channel membership is checked on both join and send events.
 * - Server persists opaque encrypted payloads without decrypting message content.
 *
 * getTokenFromHandshake/resolveUserIdFromTokenClaims/isUserAccountActive live in
 * socketAuthService.js so communitySocket.js can share the same mid-session
 * accountStatus recheck instead of duplicating it.
 */

/**
 * createDiscreetNotifications
 * ---------------------------
 * Writes a privacy-safe in-app notification for every channel participant
 * except the sender. Uses deliberately vague copy to avoid exposing
 * conversation context in notification surfaces (SSD §22.2).
 *
 * @param {import('../models').DirectChatChannel} channel
 * @param {string} senderUserId
 */
async function createDiscreetNotifications(channel, senderUserId) {
  const participantUserIds = await getChannelParticipantUserIds(channel);
  const recipients = participantUserIds.filter((id) => id && id !== senderUserId);

  // Notify every participant except the sender with privacy-safe copy.
  // createNotificationsBulk also pushes `notification:new` via Socket.io for instant badge updates.
  // entityType/entityId let the frontend deep-link the notification straight to this conversation.
  await createNotificationsBulk(recipients, 'You have a new update.', 'NEW_MESSAGE', 'CHAT', channel.chatId);
}

/**
 * broadcastPresenceForStaff
 * -------------------------
 * Emits a `presence:update` event to the per-user socket room of every survivor
 * assigned to the given staff member. Called on both connect and disconnect so
 * survivor chat UIs update the status dot without polling.
 *
 * Targets `user:<survivorUserId>` rooms, not channel rooms, so the event
 * reaches the survivor even when they are not currently viewing that channel.
 *
 * @param {import('socket.io').Server} io
 * @param {string} staffUserId   - The staff member's userId (UserAccount.userId).
 * @param {string} manualStatus  - The staff member's current DB availabilityStatus.
 */
async function broadcastPresenceForStaff(io, staffUserId, manualStatus) {
  try {
    // Find all active channels where this user is the support counterpart.
    const channels = await DirectChatChannel.findAll({
      where: {
        supportStaffCounterpartId: staffUserId,
        chatChannelStatus: 'active'
      },
      attributes: ['chatId', 'survivorId']
    });

    if (channels.length === 0) return;

    // Resolve each channel's survivor userId so we can target their personal room.
    const survivorIds = [...new Set(channels.map((ch) => ch.survivorId))];
    const survivors = await SurvivorProfile.findAll({
      where: { survivorId: { [Op.in]: survivorIds } },
      attributes: ['survivorId', 'userId']
    });
    const survivorUserIdBySurvivorId = new Map(survivors.map((s) => [s.survivorId, s.userId]));

    const effectivePresence = presenceRegistry.getEffectivePresence(staffUserId, manualStatus);

    for (const channel of channels) {
      const survivorUserId = survivorUserIdBySurvivorId.get(channel.survivorId);
      if (!survivorUserId) continue;

      // Emit to the survivor's per-user room regardless of which channel they have open.
      io.to(`user:${survivorUserId}`).emit('presence:update', {
        staffUserId,
        chatId: channel.chatId,
        presence: effectivePresence
      });
    }
  } catch (err) {
    console.error('broadcastPresenceForStaff error:', err);
  }
}

/**
 * runDeliveryCatchUp
 * ------------------
 * Marks all undelivered messages in the user's channels as delivered and
 * notifies senders. Called when a staff member or survivor reconnects so
 * messages that arrived while they were offline get delivery acknowledgement.
 *
 * @param {import('socket.io').Server} io
 * @param {string} userId - The user who just reconnected.
 */
async function runDeliveryCatchUp(io, userId) {
  try {
    // Fetch all active channels the reconnecting user participates in.
    const channels = await DirectChatChannel.findAll({
      where: {
        chatChannelStatus: 'active',
        [Op.or]: [
          // Staff-side participation (staff member reconnecting)
          { supportStaffCounterpartId: userId },
          // Survivor-side participation (survivor reconnecting)
          // We join through SurvivorProfile to match by userId.
          ...(await (async () => {
            const sp = await SurvivorProfile.findOne({ where: { userId }, attributes: ['survivorId'] });
            return sp ? [{ survivorId: sp.survivorId }] : [];
          })())
        ]
      },
      attributes: ['chatId']
    });

    if (channels.length === 0) return;

    const now = new Date();
    const chatIds = channels.map((ch) => ch.chatId);

    // Find messages sent TO this user (i.e. not by them) that haven't been delivered yet.
    const undelivered = await DirectChatMessage.findAll({
      where: {
        chatId: { [Op.in]: chatIds },
        senderUserId: { [Op.ne]: userId },
        deliveredAt: null
      },
      attributes: ['messageId', 'chatId', 'senderUserId']
    });

    if (undelivered.length === 0) return;

    // Bulk-update deliveredAt for all messages destined for this user.
    const messageIds = undelivered.map((m) => m.messageId);
    await DirectChatMessage.update(
      { deliveredAt: now },
      { where: { messageId: { [Op.in]: messageIds } } }
    );

    // Group by chatId so we emit one event per channel (easier for the frontend to handle).
    const byChatId = undelivered.reduce((acc, msg) => {
      if (!acc[msg.chatId]) acc[msg.chatId] = { messageIds: [], senderUserId: msg.senderUserId };
      acc[msg.chatId].messageIds.push(msg.messageId);
      return acc;
    }, {});

    for (const [chatId, { messageIds: ids, senderUserId }] of Object.entries(byChatId)) {
      // Notify the channel room (both parties may be listening).
      io.to(chatId).emit('message:delivered', { chatId, messageIds: ids, deliveredAt: now });

      // Also push to the original sender's per-user room in case they are not in the channel room.
      io.to(`user:${senderUserId}`).emit('message:delivered', { chatId, messageIds: ids, deliveredAt: now });
    }
  } catch (err) {
    console.error('runDeliveryCatchUp error:', err);
  }
}

/**
 * Main socket gateway. Called once at server startup with the io instance.
 *
 * @param {import('socket.io').Server} io
 */
module.exports = (io) => {
  io.on('connection', async (socket) => {
    const token = getTokenFromHandshake(socket);
    if (!token) {
      socket.emit('messageError', { error: 'Authentication required for chat socket.' });
      socket.disconnect(true);
      return;
    }

    let userId = null;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = resolveUserIdFromTokenClaims(decoded);
    } catch (error) {
      socket.emit('messageError', { error: 'Invalid session token for chat socket.' });
      socket.disconnect(true);
      return;
    }

    if (!userId) {
      socket.emit('messageError', { error: 'Invalid token payload for chat socket.' });
      socket.disconnect(true);
      return;
    }

    // Enforce account status at connection time — bans/suspensions applied after
    // token issuance are caught here without waiting for token expiry.
    const active = await isUserAccountActive(userId);
    if (!active) {
      socket.emit('messageError', { error: 'Account access restricted. Please contact support.' });
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;

    // ── Per-user room ──────────────────────────────────────────────────────────
    // Joining a personal room (`user:<userId>`) lets us push events to all of
    // a user's open tabs/windows without knowing their individual socket IDs.
    socket.join(`user:${userId}`);

    // ── Presence: mark online ──────────────────────────────────────────────────
    const justCameOnline = presenceRegistry.markOnline(userId, socket.id);

    if (justCameOnline) {
      // Resolve the user's current manual availability so BUSY is preserved.
      let manualStatus = 'AVAILABLE';
      try {
        const { CounsellorProfile, LegalCounselProfile } = require('../models');
        const counsellor = await CounsellorProfile.findOne({ where: { userId }, attributes: ['availabilityStatus'] });
        const legal = await LegalCounselProfile.findOne({ where: { userId }, attributes: ['availabilityStatus'] });
        if (counsellor) manualStatus = counsellor.availabilityStatus;
        else if (legal) manualStatus = legal.availabilityStatus;
      } catch {
        // Non-critical — defaults to AVAILABLE if profile lookup fails.
      }

      // Inform survivors' UI that this staff member is now online.
      await broadcastPresenceForStaff(io, userId, manualStatus);

      // Bulk-deliver any messages that arrived while offline.
      await runDeliveryCatchUp(io, userId);
    }

    console.log(`Client connected: ${socket.id} (userId: ${userId})`);

    // ── Join a specific chat channel room ──────────────────────────────────────
    socket.on('joinChannel', async (chatId) => {
      const allowed = await canUserAccessChannel(socket.data.userId, chatId);
      if (!allowed) {
        socket.emit('messageError', { error: 'Not authorized for this chat channel.' });
        return;
      }

      socket.join(chatId);
      console.log(`User ${userId} joined channel: ${chatId}`);
    });

    // ── Handle incoming encrypted messages ─────────────────────────────────────
    socket.on('sendEncryptedMessage', async (data) => {
      const { chatId, encryptedPayload } = data;

      try {
        if (!chatId || !encryptedPayload) {
          socket.emit('messageError', { error: 'chatId and encryptedPayload are required.' });
          return;
        }

        // Re-check account status on every send so that a ban applied after
        // the socket connection was opened takes effect without requiring reconnect.
        const stillActive = await isUserAccountActive(socket.data.userId);
        if (!stillActive) {
          socket.emit('messageError', { error: 'Account access restricted. Please contact support.' });
          socket.disconnect(true);
          return;
        }

        const allowed = await canUserAccessChannel(socket.data.userId, chatId);
        if (!allowed) {
          socket.emit('messageError', { error: 'Not authorized to send in this chat channel.' });
          return;
        }

        const channel = await DirectChatChannel.findByPk(chatId);
        if (!channel || channel.chatChannelStatus !== 'active') {
          socket.emit('messageError', { error: 'Chat channel is unavailable.' });
          return;
        }

        // Determine if the counterpart (recipient) is currently online.
        // If so, we can mark deliveredAt immediately on save.
        const counterpartUserId = channel.supportStaffCounterpartId;
        const survivorProfile = await SurvivorProfile.findOne({
          where: { survivorId: channel.survivorId },
          attributes: ['userId']
        });
        const survivorUserId = survivorProfile?.userId;

        const recipientUserId = socket.data.userId === counterpartUserId ? survivorUserId : counterpartUserId;
        const recipientOnline = recipientUserId ? presenceRegistry.isOnline(recipientUserId) : false;

        const savedMessage = await DirectChatMessage.create({
          messageId: randomUUID(),
          chatId,
          senderUserId: socket.data.userId,
          encryptedMessageContent: encryptedPayload, // Ciphertext only — server never reads plaintext
          messageReadStatus: 'UNREAD',
          // Mark delivered immediately when recipient is already connected.
          deliveredAt: recipientOnline ? new Date() : null
        });

        await createDiscreetNotifications(channel, socket.data.userId);

        // Broadcast to all clients in the channel room.
        io.to(chatId).emit('receiveMessage', savedMessage);

        // Sidebar recency signal: clients only join the channel room they are
        // currently viewing, so a message in any other channel would otherwise
        // reach them only on the next full channel-list fetch. Emitting a
        // light activity event (no message content) to both participants'
        // personal rooms lets channel lists re-sort in real time.
        const activityPayload = {
          chatId,
          lastMessageAt: savedMessage.messageDispatchTimestamp || new Date(),
          senderUserId: socket.data.userId
        };
        io.to(`user:${socket.data.userId}`).emit('channel:activity', activityPayload);
        if (recipientUserId) {
          io.to(`user:${recipientUserId}`).emit('channel:activity', activityPayload);
        }

        // Re-check presence immediately before emitting the delivery tick — the
        // recipient may have disconnected during the DirectChatMessage.create()
        // round-trip above, so the `recipientOnline` snapshot taken before that
        // write can be stale by now. The deliveredAt DB write above intentionally
        // keeps using the original snapshot (this is a display-only tick; the
        // recipient still gets the message via the delivery catch-up on reconnect
        // either way), but the live emit should reflect current state.
        const recipientStillOnline = recipientUserId ? presenceRegistry.isOnline(recipientUserId) : false;
        if (recipientStillOnline) {
          io.to(`user:${socket.data.userId}`).emit('message:delivered', {
            chatId,
            messageIds: [savedMessage.messageId],
            deliveredAt: savedMessage.deliveredAt
          });
        }
      } catch (error) {
        console.error('Failed to save and relay message:', error);
        socket.emit('messageError', { error: 'Failed to send message securely.' });
      }
    });

    // ── Handle message edits ────────────────────────────────────────────────────
    // Client re-encrypts the edited plaintext under the same shared channel key
    // and sends the new ciphertext here. The server never sees plaintext, so it
    // cannot verify the edit is meaningfully different — it only enforces that
    // the editor is the original sender and the channel is still active.
    socket.on('editEncryptedMessage', async (data) => {
      const { chatId, messageId, encryptedPayload } = data || {};

      try {
        if (!chatId || !messageId || !encryptedPayload) {
          socket.emit('messageError', { error: 'chatId, messageId, and encryptedPayload are required.' });
          return;
        }

        // Re-check account status the same way sendEncryptedMessage does, so a
        // ban applied mid-session also blocks edits, not just new sends.
        const stillActive = await isUserAccountActive(socket.data.userId);
        if (!stillActive) {
          socket.emit('messageError', { error: 'Account access restricted. Please contact support.' });
          socket.disconnect(true);
          return;
        }

        const allowed = await canUserAccessChannel(socket.data.userId, chatId);
        if (!allowed) {
          socket.emit('messageError', { error: 'Not authorized to edit messages in this chat channel.' });
          return;
        }

        const channel = await DirectChatChannel.findByPk(chatId);
        if (!channel || channel.chatChannelStatus !== 'active') {
          socket.emit('messageError', { error: 'Chat channel is unavailable.' });
          return;
        }

        const message = await DirectChatMessage.findOne({ where: { messageId, chatId } });
        if (!message) {
          socket.emit('messageError', { error: 'Message not found.' });
          return;
        }

        // Only the original sender may edit their own message.
        if (message.senderUserId !== socket.data.userId) {
          socket.emit('messageError', { error: 'You can only edit your own messages.' });
          return;
        }

        const editedAt = new Date();
        message.encryptedMessageContent = encryptedPayload;
        message.editedAt = editedAt;
        await message.save();

        // Broadcast to everyone in the channel room (both parties may have it open).
        io.to(chatId).emit('message:edited', {
          chatId,
          messageId,
          encryptedPayload,
          editedAt
        });
      } catch (error) {
        console.error('Failed to edit and relay message:', error);
        socket.emit('messageError', { error: 'Failed to edit message securely.' });
      }
    });

    // ── Disconnect — update presence registry ──────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 Client disconnected: ${socket.id} (userId: ${userId})`);

      const wentOffline = presenceRegistry.markOffline(userId, socket.id);

      if (wentOffline) {
        // The user has no remaining connections — broadcast OFFLINE to their survivors.
        // manualStatus doesn't matter here because getEffectivePresence returns OFFLINE
        // whenever isOnline() is false, but we still pass a dummy value for the helper.
        await broadcastPresenceForStaff(io, userId, 'AVAILABLE');
      }
    });
  });
};
