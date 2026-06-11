const express = require('express');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { SupportResource, ResourceAccessEvent } = require('../models');

const router = express.Router();

/**
 * Public support resource routes.
 *
 * Mounted at /api/resources from backend/index.js. These routes intentionally
 * do not require auth because the project spec allows unregistered visitors to
 * browse uploaded support resources.
 */
const normalizeCategory = (category) => category.trim().toLowerCase();

const formatCategoryLabel = (category) =>
  category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

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

router.get('/', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const category = typeof req.query.category === 'string' ? normalizeCategory(req.query.category) : '';

  const where = {};

  // Build the Sequelize WHERE object only from filters supplied by the client.
  if (category && category !== 'all') {
    where.resourceCategory = category;
  }

  if (search) {
    where[Op.or] = [
      { resourceTitle: { [Op.like]: `%${search}%` } },
      { resourceDescription: { [Op.like]: `%${search}%` } },
      { resourceCategory: { [Op.like]: `%${search}%` } }
    ];
  }

  try {
    // Return only fields needed by public tiles; uploader metadata stays private.
    const resources = await SupportResource.findAll({
      where,
      attributes: [
        'resourceId',
        'resourceTitle',
        'resourceDescription',
        'resourceCategory',
        'resourceFileUrl',
        'resourceUploadTimestamp'
      ],
      order: [['resourceUploadTimestamp', 'DESC']]
    });

    // Fetch all categories separately so filter tabs remain stable after search.
    const allCategories = await SupportResource.findAll({
      attributes: ['resourceCategory'],
      group: ['resourceCategory'],
      order: [['resourceCategory', 'ASC']]
    });

    res.json({
      resources: resources.map((resource) => ({
        id: resource.resourceId,
        title: resource.resourceTitle,
        description: resource.resourceDescription,
        category: resource.resourceCategory,
        categoryLabel: formatCategoryLabel(resource.resourceCategory),
        fileUrl: resource.resourceFileUrl,
        uploadedAt: resource.resourceUploadTimestamp
      })),
      categories: allCategories.map(({ resourceCategory }) => ({
        value: resourceCategory,
        label: formatCategoryLabel(resourceCategory)
      }))
    });
  } catch (error) {
    res.status(500).json({
      error: 'Could not load support resources.',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

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
