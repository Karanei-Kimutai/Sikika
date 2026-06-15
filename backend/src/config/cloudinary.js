const { randomUUID } = require("crypto");
const https = require("https");
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
 * Maps a MIME type to the Cloudinary resource_type required for correct delivery.
 *
 * Cloudinary's "auto" detection misclassifies PDFs as "image" which breaks
 * download URLs. Explicit mapping ensures the stored resource_type always
 * matches what Cloudinary needs to serve the file correctly.
 *
 * - "image" : raster images (JPEG, PNG, WEBP)
 * - "video" : audio and video (MP3, WAV, MP4) — Cloudinary uses "video" for both
 * - "raw"   : everything else (PDF, DOC, DOCX, TXT)
 *
 * @param {string} mimeType - MIME type from the uploaded file.
 * @returns {"image"|"video"|"raw"}
 */
function resolveCloudinaryResourceType(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "video";
  return "raw";
}

/**
 * Uploads a support-resource file to Cloudinary.
 *
 * Resource assets are grouped by category and resourceId to make moderation,
 * lifecycle cleanup, and Cloudinary console browsing easier.
 */
function uploadSupportResourceBuffer({ buffer, resourceId, category, originalFileName, mimeType }) {
  assertCloudinaryConfigured();

  const normalizedCategory = String(category || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");

  const rawName = String(originalFileName || "");
  const extMatch = rawName.match(/\.[^/.]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : "";
  const baseName = rawName.replace(/\.[^/.]+$/, "") || randomUUID();
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, "-");

  // Extension is included in the public_id for raw resources so Cloudinary sets
  // the correct Content-Type header on delivery (without it, files are served as
  // application/octet-stream and browsers can't open them).
  const publicId = `support-resources/${normalizedCategory}/${resourceId}/${safeName}-${randomUUID()}${ext}`;

  // Use explicit resource_type instead of "auto" — Cloudinary misclassifies PDFs as "image".
  const resourceType = resolveCloudinaryResourceType(mimeType);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: false,
        resource_type: resourceType,
        // Use authenticated delivery so signed URLs are required — this bypasses
        // account-level restrictions that block raw file delivery on type: upload.
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
 * Uploads a generated legal case PDF as a private Cloudinary asset.
 *
 * Legal documents are stored with the same access model as incident evidence —
 * `type: authenticated` ensures direct public access is blocked. A short-lived
 * signed URL must be generated via `generateLegalDocumentSignedUrl` to open them.
 *
 * Folder structure: legal-cases/<legalCaseId>/<uuid>
 *
 * @param {{ buffer: Buffer, legalCaseId: string }} options
 * @returns {Promise<object>} Cloudinary upload result (includes public_id, secure_url)
 */
function uploadLegalDocumentBuffer({ buffer, legalCaseId }) {
  assertCloudinaryConfigured();

  const publicId = `legal-cases/${legalCaseId}/${randomUUID()}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: false,
        resource_type: "raw",   // PDFs are raw binary assets
        type: "authenticated"   // private — no direct public access
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
 * Generates a short-lived, signed URL for accessing a private legal case document.
 *
 * Mirrors the evidence signed-URL pattern. Defaults to a 5-minute window so
 * counsel can open the PDF in a browser tab without the link expiring immediately.
 *
 * @param {{ publicId: string, expiresInSeconds?: number }} options
 * @returns {string} A short-lived signed Cloudinary URL for the raw PDF asset.
 */
function generateLegalDocumentSignedUrl({ publicId, expiresInSeconds = 300 }) {
  assertCloudinaryConfigured();

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.url(publicId, {
    resource_type: "raw",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt
  });
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

/**
 * Fetches a Cloudinary authenticated asset and pipes it into a Node.js
 * writable stream (typically an Express response).
 *
 * Uses Cloudinary's private_download_url to generate an API-credential-signed
 * download URL, then fetches it server-side. This bypasses all Cloudinary
 * account-level delivery restrictions because the request is made with API
 * credentials rather than through the public delivery network.
 *
 * Follows up to one redirect (Cloudinary occasionally returns 302 on downloads).
 *
 * @param {{ publicId: string, resourceType: string }} options
 * @param {import('http').ServerResponse} destination - Express res object to pipe into.
 * @returns {Promise<{ contentType: string, contentLength: string|null }>}
 */
function streamResourceToResponse({ publicId, resourceType }, destination) {
  assertCloudinaryConfigured();

  const downloadUrl = cloudinary.utils.private_download_url(publicId, "", {
    resource_type: resourceType || "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 300
  });

  return new Promise((resolve, reject) => {
    function fetchUrl(url) {
      https.get(url, (cloudinaryRes) => {
        // Follow a single redirect if Cloudinary returns 301/302.
        if ((cloudinaryRes.statusCode === 301 || cloudinaryRes.statusCode === 302) && cloudinaryRes.headers.location) {
          cloudinaryRes.resume();
          fetchUrl(cloudinaryRes.headers.location);
          return;
        }

        if (cloudinaryRes.statusCode !== 200) {
          reject(new Error(`Cloudinary returned HTTP ${cloudinaryRes.statusCode}`));
          return;
        }

        resolve({
          contentType: cloudinaryRes.headers["content-type"] || "application/octet-stream",
          contentLength: cloudinaryRes.headers["content-length"] || null
        });

        cloudinaryRes.pipe(destination);
      }).on("error", reject);
    }

    fetchUrl(downloadUrl);
  });
}

module.exports = {
  isCloudinaryConfigured,
  uploadEvidenceBuffer,
  generateEvidenceSignedUrl,
  uploadLegalDocumentBuffer,
  generateLegalDocumentSignedUrl,
  uploadSupportResourceBuffer,
  deleteSupportResourceAsset,
  streamResourceToResponse
};
