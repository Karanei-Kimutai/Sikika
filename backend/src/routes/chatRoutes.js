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
router.get('/:chatId/messages', authMiddleware, chatController.getMessages);

module.exports = router;