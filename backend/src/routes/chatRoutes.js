/**
 * chatRoutes.js
 * -------------
 * REST endpoints for direct (private) E2EE chat between survivors and their
 * assigned staff. All routes require a valid JWT.
 *
 * Mounted at /api/chat from backend/index.js.
 *
 * Route map:
 *   GET    /channels              → list the caller's chat channels (auto-provisioned)
 *   GET    /public-key/:userId    → fetch a user's ECDH public key for key agreement
 *   PUT    /public-key            → register or refresh the caller's ECDH public key
 *   GET    /:chatId/messages      → fetch message history for a channel
 *   PATCH  /:chatId/read          → mark all messages in a channel as read (sets seenAt)
 *   PATCH  /:chatId/status        → archive, restore, or soft-delete a channel
 *
 * Real-time messaging uses Socket.io (chatSocket.js) — these REST endpoints
 * serve history, key management, and channel lifecycle operations.
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// Return all channels for the caller; also idempotently creates missing auto-channels.
router.get('/channels', authMiddleware, chatController.getChannels);

// Fetch the ECDH public key registered by :userId — used by the local client to
// derive the shared AES-GCM key before sending an encrypted message.
router.get('/public-key/:userId', authMiddleware, chatController.getPublicKey);

// Register or refresh the caller's ECDH public key (called by App.jsx on every load).
// Broadcasts chatKey:available to counterparts so their pending queues can flush.
router.put('/public-key', authMiddleware, chatController.setPublicKey);

// Fetch decryption-ready ciphertext history for a channel (oldest first).
// Membership check is enforced in the controller.
router.get('/:chatId/messages', authMiddleware, chatController.getMessages);

// Mark all messages in the channel as READ and set seenAt; emits message:seen
// socket events to the sender so their "Seen" tick updates in real time.
router.patch('/:chatId/read', authMiddleware, chatController.markChannelRead);

// Transition the channel through its status lifecycle:
//   active ↔ archived, active/archived → deleted, deleted → active (restore)
// Soft-deletes only; data is preserved for audit.
router.patch('/:chatId/status', authMiddleware, chatController.updateChannelStatus);

module.exports = router;