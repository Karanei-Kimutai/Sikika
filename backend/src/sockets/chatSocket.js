/**
 * chatSocket.js
 * -------------
 * Handles real-time WebSocket connections for the Direct Chat module.
 * Blindly stores and relays encrypted payloads.
 */

const { v4: uuidv4 } = require('uuid');
const { DirectChatMessage } = require('../models');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Join a specific chat channel room
    socket.on('joinChannel', (chatId) => {
      socket.join(chatId);
      console.log(`User joined channel: ${chatId}`);
    });

    // Handle incoming encrypted messages
    socket.on('sendEncryptedMessage', async (data) => {
      const { chatId, senderUserId, encryptedPayload } = data;

      try {
        const savedMessage = await DirectChatMessage.create({
          messageId: uuidv4(),
          chatId,
          senderUserId,
          encryptedMessageContent: encryptedPayload, // Ciphertext only
          messageReadStatus: 'UNREAD'
        });

        io.to(chatId).emit('receiveMessage', savedMessage);
      } catch (error) {
        console.error('❌ Failed to save and relay message:', error);
        socket.emit('messageError', { error: 'Failed to send message securely.' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
};