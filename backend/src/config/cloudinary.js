const { randomUUID } = require("crypto");
const { v2: cloudinary } = require("cloudinary");

/**
 * Shared Cloudinary client configuration.
 *
 * This module supports two different storage profiles used by the app:
 * - Incident evidence: private/authenticated assets with signed access URLs.
 * - Support resources: publicly accessible assets for the resource library.
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Returns true when the minimum Cloudinary credentials are present.
 */
function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

/**
 * Throws a clear startup/runtime error when Cloudinary configuration is missing.
 */
function assertCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }
}

/**
 * Uploads survivor report evidence as a private Cloudinary asset.
 *
 * We keep evidence private using `type: authenticated` and later expose
 * short-lived signed URLs via `generateEvidenceSignedUrl`.
 */
function uploadEvidenceBuffer({ buffer, reportId, mimeType }) {
  assertCloudinaryConfigured();

  const publicId = `incident-reports/${reportId}/${randomUUID()}`;
  void mimeType;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: false,
        resource_type: "auto",
        type: "authenticated"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

/**
 * Uploads a support-resource file to Cloudinary.
 *
 * Resource assets are grouped by category and resourceId to make moderation,
 * lifecycle cleanup, and Cloudinary console browsing easier.
 */
function uploadSupportResourceBuffer({ buffer, resourceId, category, originalFileName }) {
  assertCloudinaryConfigured();

  const normalizedCategory = String(category || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  const safeName = String(originalFileName || randomUUID()).replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
  const publicId = `support-resources/${normalizedCategory}/${resourceId}/${safeName}-${randomUUID()}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: false,
        resource_type: "auto",
        type: "upload"
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

/**
 * Deletes a previously uploaded support-resource asset from Cloudinary.
 *
 * We accept `not found` as a successful cleanup outcome because records can
 * be deleted out-of-band in Cloudinary during operational maintenance.
 */
async function deleteSupportResourceAsset({ publicId, resourceType }) {
  assertCloudinaryConfigured();

  if (!publicId) return;

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType || "raw",
    type: "upload",
    invalidate: true
  });

  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Cloudinary deletion failed for ${publicId}: ${result.result}`);
  }
}

/**
 * Maps stored evidence type to the correct Cloudinary delivery resource type.
 */
function getResourceTypeForEvidence(evidenceType) {
  if (evidenceType === "image") return "image";
  if (evidenceType === "audio") return "video";
  return "raw";
}

/**
 * Generates a short-lived, signed URL for authenticated evidence access.
 */
function generateEvidenceSignedUrl({ publicId, evidenceType, expiresInSeconds = 300 }) {
  assertCloudinaryConfigured();

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.url(publicId, {
    resource_type: getResourceTypeForEvidence(evidenceType),
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt
  });
}

module.exports = {
  isCloudinaryConfigured,
  uploadEvidenceBuffer,
  generateEvidenceSignedUrl,
  uploadSupportResourceBuffer,
  deleteSupportResourceAsset
};
