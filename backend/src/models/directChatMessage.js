const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * DirectChatMessage
 * -----------------
 * An individual message within a DirectChatChannel.
 * Content is stored encrypted — the server never has access to plaintext.
 * Decryption happens only at the recipient's device.
 *
 * Relationships defined in models/index.js:
 *   - directChatMessage.belongsTo(directChatChannel)
 *   - directChatMessage.belongsTo(userAccount, as: 'sender')
 */
const DirectChatMessage = sequelize.define('directChatMessage', {
 
  messageId: {
    type:       DataTypes.STRING(36),
    primaryKey: true,
    allowNull:  false,
    comment:    'UUID primary key for this message'
  },
 
  chatId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to directChatChannel — the channel this message belongs to'
  },
 
  senderUserId: {
    type:      DataTypes.STRING(36),
    allowNull: false,
    comment:   'FK to userAccount — the user who sent this message'
  },
 
  /**
   * The message content encrypted end-to-end.
   * The server stores only the ciphertext — plaintext is never persisted.
   * TEXT type accommodates variable-length encrypted payloads.
   */
  encryptedMessageContent: {
    type:      DataTypes.TEXT,
    allowNull: false,
    comment:   'E2EE ciphertext — server never has access to plaintext'
  },
 
  messageDispatchTimestamp: {
    type:         DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment:      'UTC timestamp of when this message was sent'
  },
 
  /**
   * Read status — used to drive notification badges and delivery confirmations.
   * Delivered via Socket.io read receipts in real-time sessions.
   */
  messageReadStatus: {
    type:         DataTypes.ENUM('UNREAD', 'READ'),
    defaultValue: 'UNREAD',
    comment:      'Read status — drives notification badges and read receipts'
  },

  /**
   * UTC timestamp of when the recipient's socket acknowledged the message.
   * Set server-side on two paths:
   *  1. Immediately on create if the counterpart is currently connected.
   *  2. In bulk on counterpart reconnect (delivery catch-up in chatSocket.js).
   * NULL means the message has not yet reached an online recipient.
   */
  deliveredAt: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp when the message was delivered to an online recipient (null = not yet delivered)'
  },

  /**
   * UTC timestamp of when the sender's message was seen (READ) by the recipient.
   * Set server-side whenever messageReadStatus transitions to READ.
   * Drives the Seen tick in the sender's chat view.
   */
  seenAt: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp when the message was seen (read) by the recipient (null = not yet seen)'
  },

  /**
   * UTC timestamp of the most recent edit made by the sender to this message.
   * NULL means the message has never been edited. Only the original sender
   * may edit (enforced in chatSocket.js's editEncryptedMessage handler);
   * editing overwrites encryptedMessageContent in place rather than keeping
   * an edit history, matching the E2EE model where the server never has
   * plaintext to diff against.
   */
  editedAt: {
    type:    DataTypes.DATE,
    comment: 'UTC timestamp of the most recent edit by the sender (null = never edited)'
  }

}, {
  tableName: 'directChatMessage',
  comment:   'Individual E2EE message within a direct chat channel'
});

module.exports = DirectChatMessage;