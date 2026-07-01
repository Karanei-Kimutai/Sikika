/**
 * communityRoutes.js
 * ------------------
 * REST endpoints for community rooms, messaging, and moderation.
 * All routes require a valid JWT (authMiddleware applied globally).
 *
 * Mounted at /api/community from backend/index.js.
 *
 * Route map:
 *   GET    /rooms                          → list all community rooms + membership status
 *   POST   /rooms                          → create a new room (NGO_ADMIN only)
 *   POST   /rooms/:roomId/join             → join a room (adds RoomMembership record)
 *   GET    /rooms/:roomId/messages         → fetch message history for a room
 *   POST   /rooms/:roomId/messages         → post a new plaintext message
 *   POST   /messages/:messageId/report     → flag a message as harmful content
 *   DELETE /messages/:messageId            → remove a message (MODERATOR or NGO_ADMIN)
 *   GET    /moderation/reports             → list pending harmful-content reports queue
 *   PATCH  /moderation/reports/:reportId   → review and action a flagged report
 *
 * Moderation endpoints are accessible to both MODERATOR and NGO_ADMIN roles;
 * role enforcement is inside the controller functions.
 *
 * Real-time delivery of new and deleted messages uses Socket.io (communitySocket.js).
 */

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  listRooms,
  createRoom,
  joinRoom,
  listMessages,
  postMessage,
  reportMessage,
  deleteMessage,
  getModerationReports,
  reviewReport
} = require("../controllers/communityController");

const router = express.Router();

// All community endpoints require an authenticated session.
router.use(authMiddleware);

// Room discovery and management.
router.get("/rooms", listRooms);
router.post("/rooms", createRoom);       // NGO_ADMIN only
router.post("/rooms/:roomId/join", joinRoom);

// Message history (REST) — real-time delivery is via Socket.io.
router.get("/rooms/:roomId/messages", listMessages);
router.post("/rooms/:roomId/messages", postMessage);

// Content reporting — any authenticated user can flag a message.
router.post("/messages/:messageId/report", reportMessage);

// Moderator/admin message removal — broadcasts community:message-deleted via socket.
router.delete("/messages/:messageId", deleteMessage);

// Moderation queue — visible to MODERATOR and NGO_ADMIN only.
router.get("/moderation/reports", getModerationReports);

// Act on a flagged report: remove_message | ban_user | issue_warning | none.
// Atomically resolves the report and applies the action in one transaction.
router.patch("/moderation/reports/:reportId", reviewReport);

module.exports = router;
