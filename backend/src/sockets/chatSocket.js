/**
 * chatSocket.js
 * -------------
 * Handles real-time WebSocket connections for the Direct Chat module.
 * Blindly stores and relays encrypted payloads.
 */

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { DirectChatMessage, DirectChatChannel, InAppNotification } = require('../models');
const { canUserAccessChannel, getChannelParticipantUserIds } = require('../services/chatAccessService');

/**
 * Trust boundary notes:
 * - Token signature verification is required before socket joins are accepted.
 * - Channel membership is checked on both join and send events.
 * - Server persists opaque encrypted payloads without decrypting message content.
 */

function getTokenFromHandshake(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake?.headers?.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  return null;
}

function resolveUserIdFromTokenClaims(claims) {
  return claims?.userId || claims?.id || null;
}

async function createDiscreetNotifications(channel, senderUserId) {
  const participantUserIds = await getChannelParticipantUserIds(channel);
  const recipients = participantUserIds.filter((id) => id && id !== senderUserId);

  // Notify every participant except the sender with privacy-safe copy.
  await Promise.all(
    recipients.map((recipientUserId) =>
      InAppNotification.create({
        notificationId: randomUUID(),
        recipientUserId,
        notificationCategoryType: 'NEW_MESSAGE',
        discreetNotificationMessage: 'You have a new update.',
        notificationReadStatus: 'UNREAD'
      })
    )
  );
}

module.exports = (io) => {
  io.on('connection', (socket) => {
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

    socket.data.userId = userId;
    console.log(`Client connected: ${socket.id}`);

    // Join a specific chat channel room
    socket.on('joinChannel', async (chatId) => {
      const allowed = await canUserAccessChannel(socket.data.userId, chatId);
      if (!allowed) {
        socket.emit('messageError', { error: 'Not authorized for this chat channel.' });
        return;
      }

      socket.join(chatId);
      console.log(`User joined channel: ${chatId}`);
    });

    // Handle incoming encrypted messages
    socket.on('sendEncryptedMessage', async (data) => {
      const { chatId, encryptedPayload } = data;

      try {
        if (!chatId || !encryptedPayload) {
          socket.emit('messageError', { error: 'chatId and encryptedPayload are required.' });
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

        const savedMessage = await DirectChatMessage.create({
          messageId: randomUUID(),
          chatId,
          senderUserId: socket.data.userId,
          encryptedMessageContent: encryptedPayload, // Ciphertext only
          messageReadStatus: 'UNREAD'
        });

        await createDiscreetNotifications(channel, socket.data.userId);

        // Broadcast only to clients currently joined to this channel room.
        io.to(chatId).emit('receiveMessage', savedMessage);
      } catch (error) {
        console.error('Failed to save and relay message:', error);
        socket.emit('messageError', { error: 'Failed to send message securely.' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
};