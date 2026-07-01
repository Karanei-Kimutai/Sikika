const { randomUUID } = require("crypto");
const { Op } = require("sequelize");
const { SupportResource, UserAccount } = require("../models");
const {
  isCloudinaryConfigured,
  uploadSupportResourceBuffer,
  deleteSupportResourceAsset,
  fetchPrivateAssetStream
} = require("../config/cloudinary");

/**
 * resourceController.js
 * ---------------------
 * Resource library workflow:
 * - Anyone (including unregistered visitors) can read resources.
 * - Only COUNSELLOR, LEGAL_COUNSEL, and NGO_ADMIN can create/update/delete.
 * - Uploaded files are stored in Cloudinary and metadata is persisted in SQL.
 */

const ALLOWED_MANAGEMENT_ROLES = new Set(["COUNSELLOR", "LEGAL_COUNSEL", "NGO_ADMIN"]);

const { normalizeRole } = require("../utils/roles");

/**
 * Normalises a category string to lowercase trimmed form for consistent
 * DB storage and filter comparisons.
 *
 * @param {*} value - Raw category value from request body or query string.
 * @returns {string} Lowercase trimmed category string.
 */
function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Converts a snake_case category key into a Title Case label for display.
 * Example: "legal_guidance" → "Legal Guidance"
 *
 * @param {string} category - snake_case category string from the database.
 * @returns {string} Human-readable Title Case label.
 */
function formatCategoryLabel(category) {
  return String(category || "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Validates uploaded resource files before storage.
 *
 * This protects the system from unsupported types and ensures downstream
 * library rendering behavior remains predictable.
 */
function validateUploadedFile(file) {
  if (!file) {
    return "A resource file is required.";
  }

  const allowedMimeTypes = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
    "video/mp4"
  ]);

  if (!allowedMimeTypes.has(file.mimetype)) {
    return "Unsupported file type. Upload PDF, DOC, DOCX, TXT, JPG, PNG, WEBP, MP3, WAV, or MP4.";
  }

  return null;
}

/**
 * Resolves authenticated actor context from JWT payload claims.
 *
 * Tokens in this codebase may include either `id` or `userId`, so this helper
 * tolerates both formats and always validates account status from the DB.
 */
async function getActorContext(req) {
  const tokenUserId = req.user?.userId || req.user?.id;
  if (!tokenUserId) return null;

  const account = await UserAccount.findByPk(tokenUserId, {
    attributes: ["userId", "userRole", "role", "accountStatus"]
  });

  if (!account || account.accountStatus !== "ACTIVE") {
    return null;
  }

  return {
    userId: account.userId,
    // Trust DB role first so stale token claims cannot retain elevated access.
    role: normalizeRole(account.userRole || account.role || req.user?.role || req.user?.userRole)
  };
}

/**
 * Determines whether an authenticated actor is permitted to mutate a resource.
 *
 * NGO Admins can manage any resource. Other staff roles are limited to
 * resources they personally uploaded.
 *
 * @param {{ userId: string, role: string }} actor
 * @param {import('../models/supportResource')} resource
 * @returns {boolean}
 */
function canManageTargetResource(actor, resource) {
  if (actor.role === "NGO_ADMIN") return true;
  return String(resource.uploadedByStaffId) === String(actor.userId);
}

/**
 * Transforms a Sequelize SupportResource instance into the stable API shape
 * expected by every frontend consumer.
 *
 * Keeping the mapping in one place means DB column renames only require a
 * single change, not edits across all calling controllers.
 *
 * @param {import('../models/supportResource')} resource
 * @returns {{ id: string, title: string, description: string, category: string, categoryLabel: string, fileUrl: string, uploadedAt: Date, uploaderId: string }}
 */
function toApiResource(resource) {
  return {
    id: resource.resourceId,
    title: resource.resourceTitle,
    description: resource.resourceDescription,
    category: resource.resourceCategory,
    categoryLabel: formatCategoryLabel(resource.resourceCategory),
    fileUrl: resource.resourceFileUrl,
    uploadedAt: resource.resourceUploadTimestamp,
    uploaderId: resource.uploadedByStaffId
  };
}

/**
 * Public list endpoint used by guests and authenticated users.
 */
async function listResources(req, res) {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const category = typeof req.query.category === "string" ? normalizeCategory(req.query.category) : "";

  const where = {};

  // Optional category filter from the library tab UI.
  if (category && category !== "all") {
    where.resourceCategory = category;
  }

  // Optional search filter over title, description, and category text.
  if (search) {
    where[Op.or] = [
      { resourceTitle: { [Op.like]: `%${search}%` } },
      { resourceDescription: { [Op.like]: `%${search}%` } },
      { resourceCategory: { [Op.like]: `%${search}%` } }
    ];
  }

  try {
    // Keep payload light by selecting only fields required by the UI list.
    const resources = await SupportResource.findAll({
      where,
      attributes: [
        "resourceId",
        "resourceTitle",
        "resourceDescription",
        "resourceCategory",
        "resourceFileUrl",
        "uploadedByStaffId",
        "resourceUploadTimestamp"
      ],
      order: [["resourceUploadTimestamp", "DESC"]]
    });

    // Build stable category tabs from all known categories, not just filtered rows.
    const allCategories = await SupportResource.findAll({
      attributes: ["resourceCategory"],
      group: ["resourceCategory"],
      order: [["resourceCategory", "ASC"]]
    });

    return res.json({
      resources: resources.map(toApiResource),
      categories: allCategories.map(({ resourceCategory }) => ({
        value: resourceCategory,
        label: formatCategoryLabel(resourceCategory)
      }))
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not load support resources.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
}

/**
 * Create endpoint for support staff and NGO admins.
 */
async function createResource(req, res) {
  try {
    // Resource uploads depend on Cloudinary; fail fast with actionable message.
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: "Cloudinary is not configured for resource uploads." });
    }

    const actor = await getActorContext(req);
    if (!actor) {
      return res.status(401).json({ error: "Invalid authentication context." });
    }

    // RBAC: only staff roles that curate resources can create new entries.
    if (!ALLOWED_MANAGEMENT_ROLES.has(actor.role)) {
      return res.status(403).json({ error: "Only counsellors, legal counsel, and NGO admins can upload resources." });
    }

    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const category = normalizeCategory(req.body.category);

    if (!title || !category) {
      return res.status(400).json({ error: "Title and category are required." });
    }

    const uploadValidationError = validateUploadedFile(req.file);
    if (uploadValidationError) {
      return res.status(400).json({ error: uploadValidationError });
    }

    // Generate DB primary key first so Cloudinary path includes app-level ID.
    const resourceId = randomUUID();

    // Upload binary content, then persist resulting Cloudinary metadata.
    const uploaded = await uploadSupportResourceBuffer({
      buffer: req.file.buffer,
      resourceId,
      category,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype
    });

    const created = await SupportResource.create({
      resourceId,
      resourceTitle: title,
      resourceDescription: description || null,
      resourceCategory: category,
      resourceFileUrl: uploaded.secure_url,
      cloudinaryPublicId: uploaded.public_id,
      cloudinaryResourceType: uploaded.resource_type,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      uploadedByStaffId: actor.userId
    });

    return res.status(201).json({ resource: toApiResource(created) });
  } catch (error) {
    return res.status(500).json({
      error: "Could not upload support resource.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
}

/**
 * Update endpoint for support staff and NGO admins.
 *
 * Supports metadata-only updates and optional file replacement in one request.
 */
async function updateResource(req, res) {
  try {
    const actor = await getActorContext(req);
    if (!actor) {
      return res.status(401).json({ error: "Invalid authentication context." });
    }

    if (!ALLOWED_MANAGEMENT_ROLES.has(actor.role)) {
      return res.status(403).json({ error: "Only counsellors, legal counsel, and NGO admins can update resources." });
    }

    const resource = await SupportResource.findByPk(req.params.resourceId);
    if (!resource) {
      return res.status(404).json({ error: "Resource not found." });
    }

    if (!canManageTargetResource(actor, resource)) {
      return res.status(403).json({
        error: "You can only update resources you uploaded. NGO admins may update any resource."
      });
    }

    const title = req.body.title !== undefined ? String(req.body.title).trim() : resource.resourceTitle;
    const description = req.body.description !== undefined ? String(req.body.description).trim() : resource.resourceDescription;
    const category = req.body.category !== undefined ? normalizeCategory(req.body.category) : resource.resourceCategory;

    if (!title || !category) {
      return res.status(400).json({ error: "Title and category are required." });
    }

    // Track old asset metadata so we can delete replaced files after save.
    let previousPublicId = null;
    let previousResourceType = null;

    if (req.file) {
      if (!isCloudinaryConfigured()) {
        return res.status(500).json({ error: "Cloudinary is not configured for resource uploads." });
      }

      const uploadValidationError = validateUploadedFile(req.file);
      if (uploadValidationError) {
        return res.status(400).json({ error: uploadValidationError });
      }

      // Upload replacement first to avoid data loss if upload fails.
      const replacementUpload = await uploadSupportResourceBuffer({
        buffer: req.file.buffer,
        resourceId: resource.resourceId,
        category,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype
      });

      previousPublicId = resource.cloudinaryPublicId;
      previousResourceType = resource.cloudinaryResourceType;

      resource.resourceFileUrl = replacementUpload.secure_url;
      resource.cloudinaryPublicId = replacementUpload.public_id;
      resource.cloudinaryResourceType = replacementUpload.resource_type;
      resource.originalFileName = req.file.originalname;
      resource.mimeType = req.file.mimetype;
      resource.fileSizeBytes = req.file.size;
    }

    resource.resourceTitle = title;
    resource.resourceDescription = description || null;
    resource.resourceCategory = category;

    await resource.save();

    // Cleanup old Cloudinary object only after DB update succeeds.
    if (previousPublicId) {
      await deleteSupportResourceAsset({
        publicId: previousPublicId,
        resourceType: previousResourceType
      });
    }

    return res.json({ resource: toApiResource(resource) });
  } catch (error) {
    return res.status(500).json({
      error: "Could not update support resource.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
}

/**
 * Delete endpoint for support staff and NGO admins.
 *
 * The DB row is removed first; Cloudinary cleanup runs immediately after.
 */
async function deleteResource(req, res) {
  try {
    const actor = await getActorContext(req);
    if (!actor) {
      return res.status(401).json({ error: "Invalid authentication context." });
    }

    if (!ALLOWED_MANAGEMENT_ROLES.has(actor.role)) {
      return res.status(403).json({ error: "Only counsellors, legal counsel, and NGO admins can delete resources." });
    }

    const resource = await SupportResource.findByPk(req.params.resourceId);
    if (!resource) {
      return res.status(404).json({ error: "Resource not found." });
    }

    if (!canManageTargetResource(actor, resource)) {
      return res.status(403).json({
        error: "You can only delete resources you uploaded. NGO admins may delete any resource."
      });
    }

    await resource.destroy();

    // Best-effort Cloudinary cleanup; skip when cloud credentials are absent.
    if (resource.cloudinaryPublicId && isCloudinaryConfigured()) {
      await deleteSupportResourceAsset({
        publicId: resource.cloudinaryPublicId,
        resourceType: resource.cloudinaryResourceType
      });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({
      error: "Could not delete support resource.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
}

/**
 * GET /api/resources/:resourceId/file
 *
 * Streams the resource file to the client via the backend, fetching it from
 * Cloudinary using API credentials. This avoids exposing Cloudinary delivery
 * URLs to the browser and bypasses account-level delivery restrictions that
 * block raw/authenticated assets when accessed directly.
 *
 * Sets Content-Disposition to suggest the original filename for the download.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function streamResourceFile(req, res) {
  try {
    const resource = await SupportResource.findByPk(req.params.resourceId, {
      attributes: ["resourceId", "cloudinaryPublicId", "cloudinaryResourceType", "originalFileName", "mimeType"]
    });

    if (!resource) {
      return res.status(404).json({ error: "Resource not found." });
    }

    if (!resource.cloudinaryPublicId) {
      return res.status(404).json({ error: "No file is associated with this resource." });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ error: "File storage is not configured." });
    }

    // Fetch the Cloudinary stream + headers first. fetchPrivateAssetStream
    // resolves with the readable stream so we can write all response headers
    // before the first byte reaches the client.
    const { stream, contentType, contentLength } = await fetchPrivateAssetStream({
      publicId: resource.cloudinaryPublicId,
      resourceType: resource.cloudinaryResourceType || "raw"
    });

    // Set all headers before piping so they are guaranteed to reach the client.
    const safeName = encodeURIComponent(resource.originalFileName || "resource");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Content-Type", resource.mimeType || contentType);
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    // Propagate mid-stream Cloudinary errors so the socket is cleaned up and
    // the client sees a connection reset rather than a hanging download.
    stream.on("error", (streamErr) => {
      console.error("[resource] Cloudinary stream error:", streamErr.message);
      res.destroy(streamErr);
    });

    stream.pipe(res);
  } catch (error) {
    console.error("[resource] streamResourceFile error:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Could not stream resource file.",
        details: process.env.NODE_ENV === "production" ? undefined : error.message
      });
    }
  }
}

module.exports = {
  listResources,
  createResource,
  updateResource,
  deleteResource,
  streamResourceFile
};
