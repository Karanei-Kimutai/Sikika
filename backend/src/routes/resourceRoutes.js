const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const {
  listResources,
  createResource,
  updateResource,
  deleteResource
} = require('../controllers/resourceController');

const router = express.Router();

/**
 * Multer in-memory storage is used so files can be streamed directly to
 * Cloudinary without touching local disk.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

/**
 * Public support resource routes.
 *
 * Mounted at /api/resources from backend/index.js.
 *
 * Access model:
 * - GET is public so unregistered visitors can browse support content.
 * - POST/PATCH/DELETE require auth and are RBAC-enforced in the controller.
 */
router.get('/', listResources);
router.post('/', authMiddleware, upload.single('file'), createResource);
router.patch('/:resourceId', authMiddleware, upload.single('file'), updateResource);
router.delete('/:resourceId', authMiddleware, deleteResource);

module.exports = router;
