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

router.use(authMiddleware);

router.get("/rooms", listRooms);
router.post("/rooms", createRoom);
router.post("/rooms/:roomId/join", joinRoom);
router.get("/rooms/:roomId/messages", listMessages);
router.post("/rooms/:roomId/messages", postMessage);

router.post("/messages/:messageId/report", reportMessage);
router.delete("/messages/:messageId", deleteMessage);

router.get("/moderation/reports", getModerationReports);
router.patch("/moderation/reports/:reportId", reviewReport);

module.exports = router;
