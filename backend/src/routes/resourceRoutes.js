const express = require('express');
const { Op } = require('sequelize');
const { SupportResource } = require('../models');

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

module.exports = router;
