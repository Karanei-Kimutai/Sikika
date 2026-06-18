# Cloudinary

This document covers how Cloudinary is used on Sikika — what gets stored, which storage profiles are used for each asset type, how files are uploaded and retrieved, and how the proxy-based delivery model works.

All Cloudinary logic lives in `backend/src/config/cloudinary.js`.

---

## Overview

The platform uses Cloudinary for three categories of file storage:

| Asset type | Upload type | Access model |
|------------|-------------|--------------|
| Incident evidence | `authenticated` | Private — backend streams file bytes to client |
| Support resources | `authenticated` | Private — backend proxies file to client |
| Legal case PDFs | `authenticated` | Private — backend streams file bytes to client |

All three use `type: authenticated`, meaning Cloudinary blocks all direct public access. Nothing stored on this platform is reachable via an unauthenticated URL.

---

## Configuration

Cloudinary is initialised once at module load in `backend/src/config/cloudinary.js`:

```js
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});
```

Required env vars:

| Variable | Description |
|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | API key |
| `CLOUDINARY_API_SECRET` | API secret — used to sign URLs and authenticate server-side requests |

`isCloudinaryConfigured()` checks all three are present. Every upload and delivery function calls `assertCloudinaryConfigured()` first, which throws a clear error if any are missing. Without Cloudinary config, upload endpoints return 503 but read endpoints that don't require files still work.

---

## Cloudinary Concepts

### resource_type

Cloudinary stores assets under one of three resource types:

| resource_type | Used for |
|---------------|----------|
| `image` | JPEG, PNG, WEBP |
| `video` | MP3, WAV, MP4 — Cloudinary uses "video" for audio too |
| `raw` | PDF, DOC, DOCX, TXT — anything that isn't image or video |

The `resource_type` must match at both upload and retrieval time. Using the wrong type at retrieval causes a 404 or 401 from Cloudinary.

**Important:** Cloudinary's `resource_type: "auto"` misclassifies PDFs as `image`. The platform uses `resolveCloudinaryResourceType(mimeType)` to map MIME types explicitly rather than relying on auto-detection.

### type

Cloudinary's `type` controls who can access the asset:

| type | Access |
|------|--------|
| `upload` | Publicly accessible via URL — no credentials required |
| `authenticated` | Blocked unless accessed via a signed URL or API credentials |

All platform assets use `type: authenticated`. This was chosen because Cloudinary account-level security settings can silently block `type: upload` raw file delivery (returning 401 even on public assets), and `authenticated` is consistent and predictable across account configurations.

### public_id

The `public_id` is Cloudinary's identifier for an asset — it's the path within the cloud, not including the cloud name or resource type. The platform constructs `public_id` values with structured folder paths so assets are easy to locate in the Cloudinary console:

```
incident-reports/<reportId>/<uuid>
support-resources/<category>/<resourceId>/<safeName>-<uuid>.<ext>
legal-cases/<legalCaseId>/<uuid>
```

The file extension is included in the `public_id` for support resources. Without it, Cloudinary serves raw files as `application/octet-stream` with no Content-Type, which browsers cannot open.

---

## Asset Profiles

### Incident Evidence

**Upload function:** `uploadEvidenceBuffer({ buffer, reportId, mimeType })`

- Uses `resolveCloudinaryResourceType(mimeType)` for explicit `resource_type` mapping — avoids PDF misclassification as `image`.
- Uses `type: "authenticated"` — evidence is private to the survivor and their assigned staff.
- `public_id` format: `incident-reports/<reportId>/<uuid>`

**Retrieval:** `fetchPrivateAssetStream({ publicId, resourceType })` via report controller proxy route.

The backend fetches evidence server-side using API credentials and streams the bytes to the client. The frontend calls the report endpoint with `responseType: blob`, builds an object URL, and opens it in a new tab. Cloudinary URLs never reach the browser.

**Route:** `GET /api/reports/:reportId/evidence/:evidenceId/file`

---

### Support Resources

**Upload function:** `uploadSupportResourceBuffer({ buffer, resourceId, category, originalFileName, mimeType })`

- Uses `resolveCloudinaryResourceType(mimeType)` for explicit `resource_type` — avoids the PDF-as-image misclassification.
- Uses `type: "authenticated"` — even though resources are meant to be accessible to all authenticated users, the authenticated type is used because `type: upload` raw files were returning 401 due to account-level Cloudinary security settings.
- `public_id` format: `support-resources/<category>/<resourceId>/<safeName>-<uuid>.<ext>` — extension is preserved.

**Retrieval:** `fetchPrivateAssetStream({ publicId, resourceType })`

Support resources are **not** delivered via a redirect to a Cloudinary URL. Instead, the backend proxies the file:

1. `cloudinary.utils.private_download_url()` generates an API-credential-signed download URL (valid for 5 minutes) server-side.
2. The backend makes an HTTPS request to that URL using Node's built-in `https` module.
3. The response is piped directly into the Express `res` object.
4. The browser receives the file content from the backend, never seeing a Cloudinary URL.

This was necessary because signed Cloudinary URLs for `raw/authenticated` assets returned 401 when opened directly in the browser. The proxy approach uses API credentials on the server side, which bypasses delivery restrictions entirely.

The proxy also follows one redirect — Cloudinary occasionally returns `302` on private downloads.

**Route:** `GET /api/resources/:resourceId/file`

The frontend opens `<apiBase>/api/resources/<id>/file` in a new tab. The backend streams the file with `Content-Disposition: inline` and the original filename, so the browser displays the file in-tab (for PDFs) or prompts a download (for other types).

---

### Legal Case PDFs

**Upload function:** `uploadLegalDocumentBuffer({ buffer, legalCaseId })`

- Uses `resource_type: "raw"` — PDFs are always raw binary assets.
- Uses `type: "authenticated"` — legal documents are private to the case.
- `public_id` format: `legal-cases/<legalCaseId>/<uuid>`

**Retrieval:** `fetchPrivateAssetStream({ publicId, resourceType: "raw" })` via legal-case controller proxy route.

The backend fetches the PDF server-side and streams it to the client with `Content-Type: application/pdf` and `Content-Disposition: inline`.

**Route:** `GET /api/legal-cases/:id/document`

---

## Delivery Architecture

The three asset types use different delivery strategies:

```
Evidence
  Upload → Cloudinary (authenticated, resource_type: explicit from MIME)
  Access → Frontend calls /api/reports/:reportId/evidence/:evidenceId/file
         → Backend fetches from Cloudinary with API credentials
         → Backend streams file bytes to browser

Support Resources
  Upload → Cloudinary (authenticated, resource_type: explicit from MIME)
  Access → Frontend calls /api/resources/:id/file
         → Backend fetches from Cloudinary with API credentials
         → Backend streams file to browser (browser never sees Cloudinary URL)

Legal Case PDFs
  Upload → Cloudinary (authenticated, resource_type: raw)
  Access → Frontend calls /api/legal-cases/:id/document
         → Backend fetches from Cloudinary with API credentials
         → Backend streams PDF bytes to browser
```

Support resources use backend proxying rather than signed URL redirect because:

1. `type: upload` raw files returned 401 due to Cloudinary account security settings.
2. Signed URLs for `type: authenticated` raw files also returned 401 when opened in the browser — Cloudinary's `expires_at` parameter is not supported for `raw` resource types in the same way as images, causing signature verification to fail.
3. `private_download_url` uses API credentials server-side, which is not subject to delivery-layer restrictions.

---

## File Deletion

**Function:** `deleteSupportResourceAsset({ publicId, resourceType })`

Called when a support resource is deleted or its file is replaced during an update. Uses `cloudinary.uploader.destroy()` with `invalidate: true` to purge the CDN cache.

Treats `"not found"` as a success — assets can be deleted out-of-band in the Cloudinary console during operational maintenance, and the DB delete should still succeed cleanly.

Evidence files and legal case PDFs are not deleted from Cloudinary when their DB records are removed — they are retained for audit purposes.

---

## Allowed File Types

Support resources and evidence uploads share the same MIME type allowlist:

| Type | MIME types |
|------|-----------|
| Documents | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain` |
| Images | `image/jpeg`, `image/png`, `image/webp` |
| Audio | `audio/mpeg`, `audio/wav` |
| Video | `video/mp4` |

Max upload size: **20MB** (enforced by Multer before the file reaches Cloudinary).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloud name from your Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Yes | API key |
| `CLOUDINARY_API_SECRET` | Yes | API secret — keep this private, it signs all server-side requests |

Without all three, any endpoint that uploads or retrieves files returns 503. The server still starts normally — Cloudinary config is not validated at boot time.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Upload endpoint returns 503 | Cloudinary env vars missing or empty | Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env` |
| Upload succeeds but file can't be viewed | Wrong `resource_type` stored — Cloudinary classified the file incorrectly | Delete the record and re-upload; the platform now maps MIME types explicitly |
| Resource file returns 401 | Cloudinary account-level delivery restriction | The proxy endpoint (`/api/resources/:id/file`) bypasses this — ensure you're not using the raw Cloudinary URL directly |
| Evidence signed URL returns 404 | `resource_type` in URL generation doesn't match upload type | Check `evidenceFile.evidenceType` in DB matches what `getResourceTypeForEvidence` returns |
| Legal case PDF link expired | Signed URLs expire after 5 minutes | Refresh the page to generate a new signed URL |
| Deletion returns error | `publicId` or `resourceType` doesn't match what was stored | Check `cloudinaryPublicId` and `cloudinaryResourceType` columns in `supportResource` table |
