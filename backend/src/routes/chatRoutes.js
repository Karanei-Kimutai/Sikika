/**
 * chatRoutes.js
 * -------------
 * Express router mapping historical messaging endpoints.
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/channels', authMiddleware, chatController.getChannels);
router.get('/public-key/:userId', authMiddleware, chatController.getPublicKey);
router.put('/public-key', authMiddleware, chatController.setPublicKey);
router.get('/:chatId/messages', authMiddleware, chatController.getMessages);
router.patch('/:chatId/read', authMiddleware, chatController.markChannelRead);
router.patch('/:chatId/status', authMiddleware, chatController.updateChannelStatus);

module.exports = router;