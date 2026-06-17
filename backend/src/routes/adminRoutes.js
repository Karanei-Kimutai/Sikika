const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getNgoDashboard,
  globalSearch,
  setMaintenanceMode,
  createNgoResource,
  updateNgoResource,
  reassignSurvivor,
  getReassignmentSuggestions,
  createStaffAccount,
  updateStaffAccountStatus,
  banUser,
  unbanUser,
  listBannedUsers
} = require('../controllers/adminController');

const router = express.Router();

/**
 * Admin routes
 * ------------
 * Mounted at /api/admin.
 * All endpoints require authMiddleware, while controllers enforce role scopes.
 * NGO_ADMIN is the only admin role — System Admin has been removed; the one
 * capability it owned that's still needed (maintenance mode) is retained here,
 * re-gated to NGO_ADMIN.
 */
router.use(authMiddleware);

// NGO Admin operations
router.get('/ngo/dashboard', getNgoDashboard);
router.patch('/ngo/reassignments', reassignSurvivor);
router.get('/ngo/reassignments/suggestions', getReassignmentSuggestions);
router.post('/ngo/resources', createNgoResource);
router.patch('/ngo/resources/:resourceId', updateNgoResource);
router.post('/ngo/staff', createStaffAccount);
router.patch('/ngo/staff/:userId/status', updateStaffAccountStatus);

// User ban/unban — applies and lifts the BANNED lifecycle state.
// Targets SURVIVOR, COUNSELLOR, LEGAL_COUNSEL; admin/staff-lifecycle roles are not bannable.
// Role enforcement is inside the controller (getActor + roleForbidden pattern).
router.patch('/ngo/users/:userId/ban', banUser);
router.patch('/ngo/users/:userId/unban', unbanUser);
// Banned-user registry — returns all BANNED accounts with metadata for review.
router.get('/ngo/banned-users', listBannedUsers);

// Shared admin utility
router.get('/search', globalSearch);
router.post('/system/maintenance-mode', setMaintenanceMode);

module.exports = router;
