const { randomUUID } = require("crypto");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function assertCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }
}

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

function getResourceTypeForEvidence(evidenceType) {
  if (evidenceType === "image") return "image";
  if (evidenceType === "audio") return "video";
  return "raw";
}

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
  generateEvidenceSignedUrl
};
