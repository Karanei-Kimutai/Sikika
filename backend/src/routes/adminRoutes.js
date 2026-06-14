const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getNgoDashboard,
  getSystemDashboard,
  globalSearch,
  setMaintenanceMode,
  createNgoResource,
  updateNgoResource,
  reassignSurvivor,
  getSystemLogs,
  performRuntimeAction,
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
 * All endpoints require authMiddleware, while controllers enforce role scopes:
 * - NGO_ADMIN: ngo dashboard operations and staff lifecycle management
 * - SYSTEM_ADMIN: infrastructure/runtime operations
 */
router.use(authMiddleware);

// NGO Admin operations
router.get('/ngo/dashboard', getNgoDashboard);
router.patch('/ngo/reassignments', reassignSurvivor);
router.post('/ngo/resources', createNgoResource);
router.patch('/ngo/resources/:resourceId', updateNgoResource);
// Staff lifecycle moved to NGO scope so onboarding/suspension follows
// operational ownership boundaries rather than infra ownership.
router.post('/ngo/staff', createStaffAccount);
router.patch('/ngo/staff/:userId/status', updateStaffAccountStatus);

// User ban/unban — applies and lifts the BANNED lifecycle state.
// Targets SURVIVOR, COUNSELLOR, LEGAL_COUNSEL; NGO_ADMIN/SYSTEM_ADMIN are not bannable.
// Role enforcement is inside the controller (getActor + roleForbidden pattern).
router.patch('/ngo/users/:userId/ban', banUser);
router.patch('/ngo/users/:userId/unban', unbanUser);
// Banned-user registry — returns all BANNED accounts with metadata for review.
router.get('/ngo/banned-users', listBannedUsers);

// System Admin operations
router.get('/system/dashboard', getSystemDashboard);
router.get('/system/logs', getSystemLogs);
router.post('/system/runtime-action', performRuntimeAction);
// Intentionally no /system/staff routes: staffing is delegated to NGO admins.

// Shared admin utility
router.get('/search', globalSearch);
router.post('/system/maintenance-mode', setMaintenanceMode);

module.exports = router;
