const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const {
  listResources,
  createResource,
  updateResource,
  deleteResource,
  streamResourceFile
} = require('../controllers/resourceController');
const { SupportResource, ResourceAccessEvent } = require('../models');

const router = express.Router();

/**
 * Multer in-memory storage is used so files can be streamed directly to
 * Cloudinary without touching local disk.
 */
function tryExtractUserId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.slice('Bearer '.length).trim(), process.env.JWT_SECRET);
    return decoded.userId || decoded.id || null;
  } catch {
    return null;
  }
}
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
router.get('/:resourceId/file', streamResourceFile);
router.post('/', authMiddleware, upload.single('file'), createResource);
router.patch('/:resourceId', authMiddleware, upload.single('file'), updateResource);
router.delete('/:resourceId', authMiddleware, deleteResource);

router.post('/:resourceId/track-access', async (req, res) => {
  // Best-effort analytics endpoint used by frontend when a resource is opened.
  // Auth token is optional; anonymous opens are still recorded with null accessor.
  try {
    const resource = await SupportResource.findByPk(req.params.resourceId, {
      attributes: ['resourceId']
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    const accessorUserId = tryExtractUserId(req);
    await ResourceAccessEvent.create({
      accessEventId: randomUUID(),
      resourceId: resource.resourceId,
      accessorUserId,
      accessChannel: 'WEB'
    });

    return res.status(201).json({ tracked: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not track resource access.' });
  }
});

module.exports = router;
