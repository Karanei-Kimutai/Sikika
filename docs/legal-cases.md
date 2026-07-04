# Legal Cases

This document covers the legal case module: how legal cases are created from reports, the authoring workflow for legal counsel, PDF document generation, and the case lifecycle state machine.

---

## Overview

A legal case (`LegalCaseFile`) is an artifact automatically provisioned when an incident report enters the legal stage of the support workflow. It provides a structured space for legal counsel to:

1. Draft four authoring fields: case summary, legal grounds, requested relief, and recommended actions.
2. Generate a formatted PDF from those fields.
3. Track the case through its own lifecycle (separate from but synchronized with the parent report).

The generated PDF is a **handover document** — it is authored and submitted manually by legal counsel to courts, law enforcement, or other bodies. The Sikika platform makes no automated submissions to any external authority.

---

## Legal Case Creation

Legal cases are created automatically by `ensureLegalCaseForWorkflow` (in `reportController.js`) when a report status update triggers one of two transitions:

| Report Status Transition | Case Created With |
|---|---|
| → `LEGAL_REVIEW` | `currentCaseStatus = "UNDER_INVESTIGATION"` |
| → `ESCALATED_TO_LEGAL_CASE` | `currentCaseStatus = "READY_FOR_SUBMISSION"`, `escalationTimestamp` updated |

The `findOrCreate` pattern makes this idempotent — calling the endpoint multiple times for the same report will not create duplicate legal case rows.

**Survivor consent is required for escalation:** `PATCH /api/reports/:reportId/status` with `reportStatus = "ESCALATED_TO_LEGAL_CASE"` requires `survivorConsent: true` in the request body. This is enforced in `reportController.updateReportStatus` before `ensureLegalCaseForWorkflow` is called.

When the parent report is resolved, `LegalCaseFile.currentCaseStatus` is set to `"CLOSED"` automatically to keep both lifecycles synchronized.

---

## Legal Case Lifecycle

The `currentCaseStatus` field follows its own state machine, independent of the parent report status:

```
OPEN → UNDER_INVESTIGATION → READY_FOR_SUBMISSION → SUBMITTED → CLOSED
```

Defined in `CASE_STATUS_TRANSITIONS` in `legalCaseController.js`:

```
OPEN                  → [UNDER_INVESTIGATION]
UNDER_INVESTIGATION   → [READY_FOR_SUBMISSION]
READY_FOR_SUBMISSION  → [SUBMITTED]
SUBMITTED             → [CLOSED]
CLOSED                → []
```

`SUBMITTED` and `CLOSED` are terminal — no further transitions are permitted. All status advances are enforced server-side; skipping steps or reverting to earlier states returns HTTP 400.

---

## Access Control

All legal case endpoints require authentication. Only `LEGAL_COUNSEL` may call these endpoints; any other role (including `NGO_ADMIN`) receives HTTP 403.

Within the `LEGAL_COUNSEL` role, access is further scoped: legal counsel can only operate on cases linked to survivors currently assigned to their `legalCounselId`. This is enforced in `resolveCaseForCounsel`, which:

1. Fetches the `LegalCaseFile` by ID.
2. Resolves the linked `IncidentReport` → `survivorId`.
3. Verifies that `SurvivorProfile.assignedLegalCounselId === legalCounselId`.
4. Returns `null` (causing a 404 response) if any step fails.

---

## REST Endpoints

All endpoints are prefixed `/api/legal-cases/:legalCaseId`.

### Save Draft

`PATCH /api/legal-cases/:legalCaseId`

Saves one or more of the four structured authoring fields. Idempotent — fields not present in the request body are left unchanged. Always updates `draftLastUpdatedAt`.

Accepted body fields:

| Field | Description |
|---|---|
| `caseSummary` | Narrative summary of the case |
| `legalGroundsText` | Applicable laws and legal arguments |
| `requestedReliefText` | Relief or remedies being sought |
| `recommendedActionsText` | Recommended next steps for the survivor |

Empty strings are accepted to clear a field. The endpoint returns 400 if none of the four recognised fields are present in the body.

### Update Case Status

`PATCH /api/legal-cases/:legalCaseId/status`

Body: `{ status: string }`

Advances the case to the next lifecycle status per `CASE_STATUS_TRANSITIONS`. Returns 400 if the requested transition is not allowed from the current state. Returns the updated `legalCaseId` and `currentCaseStatus`.

### Generate Document

`POST /api/legal-cases/:legalCaseId/document`

Renders the current draft fields into a PDF using `legalDocumentService.buildLegalCasePdfBuffer` (pdfkit, in-memory) and uploads the result privately to Cloudinary as a `raw` asset. Stores the Cloudinary `public_id` in `LegalCaseFile.generatedDocumentPath` and sets `documentGeneratedAt`.

Requires Cloudinary to be configured — returns HTTP 503 if `isCloudinaryConfigured()` returns false.

Generating a new document overwrites the previously stored `generatedDocumentPath`. Each generation creates a new Cloudinary asset; old versions are not cleaned up automatically.

### Stream Document

`GET /api/legal-cases/:legalCaseId/document`

Streams the generated PDF to the client via the backend. The client must set `responseType: "blob"` and create a local object URL. Cloudinary URLs never reach the browser.

Returns HTTP 404 if no document has been generated yet (`generatedDocumentPath` is null).

Response headers set before piping:
- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="legal-case-<legalCaseId>.pdf"`
- `Content-Length: <bytes>` (when available from Cloudinary)

---

## PDF Document Structure

`backend/src/services/legalDocumentService.js` — `buildLegalCasePdfBuffer(legalCaseData, reportData)`

The PDF is rendered in memory using pdfkit. It includes:

- **Header:** Platform name and document title.
- **Case metadata:** Report ID, incident category, severity, incident date, incident location.
- **Case Summary:** Content of `caseSummary`.
- **Legal Grounds:** Content of `legalGroundsText`.
- **Requested Relief:** Content of `requestedReliefText`.
- **Recommended Actions:** Content of `recommendedActionsText`.
- **Footer:** Generated timestamp and disclaimer that the document requires manual submission.

Fields with no content are omitted from the rendered output rather than printing blank sections.

---

## Data Model

### `LegalCaseFile`

| Column | Type | Notes |
|---|---|---|
| `legalCaseId` | `VARCHAR(36)` PK | UUID |
| `reportId` | `VARCHAR(36)` FK | → IncidentReport (1-to-1) |
| `escalationTimestamp` | `DATE` | Set on creation; updated on `ESCALATED_TO_LEGAL_CASE` transition |
| `currentCaseStatus` | `ENUM` | `OPEN`, `UNDER_INVESTIGATION`, `READY_FOR_SUBMISSION`, `SUBMITTED`, `CLOSED` |
| `generatedDocumentPath` | `STRING` | Cloudinary `public_id` for the generated PDF (null until first generation) |
| `caseSummary` | `TEXT` | Authoring field |
| `legalGroundsText` | `TEXT` | Authoring field |
| `requestedReliefText` | `TEXT` | Authoring field |
| `recommendedActionsText` | `TEXT` | Authoring field |
| `draftLastUpdatedAt` | `DATE` | Updated on every `saveDraft` call |
| `documentGeneratedAt` | `DATE` | Updated on every `generateDocument` call |

---

## Cloudinary Storage

Legal case PDFs are stored under the `legal-documents/` folder path in Cloudinary, using `type: "raw"` (not image or video). The Cloudinary `public_id` stored in `generatedDocumentPath` is an opaque identifier used exclusively by the backend streaming proxy; clients never receive or use it directly.

The `fetchPrivateAssetStream` helper in `backend/src/config/cloudinary.js` handles:
1. Generating a short-lived private download URL using Cloudinary's signed URL API.
2. Fetching that URL server-side.
3. Returning the response stream, content type, and content length.

All three private asset classes on the platform (evidence files, support resources, legal PDFs) use this same helper, parameterized by `publicId` and `resourceType`.

---

## Frontend Integration

### `LegalCounselView.jsx` (inside `ReportingPage.jsx`)

The legal case authoring panel is rendered for `LEGAL_COUNSEL` users when viewing a report in `LEGAL_REVIEW` or `ESCALATED_TO_LEGAL_CASE` status. Panel controls:

- **Four textarea fields** for the authoring content.
- **Save Draft button** — calls `PATCH /api/legal-cases/:legalCaseId`, shows a success or error message.
- **Generate Document button** — calls `POST /api/legal-cases/:legalCaseId/document`, shows a success message and enables the Open Document button.
- **Open Document button** — calls `GET /api/legal-cases/:legalCaseId/document` as a blob, creates a local object URL, and opens it in a new tab.
- **Status advance controls** — legal-stage status transitions via `PATCH /api/legal-cases/:legalCaseId/status`.

The frontend service layer is in `frontend/src/services/legalCases.js`.

### Draft State Loading

When `LegalCounselView` loads a report, the `legalCase` object embedded in the report response (`toApiReport` in `reportController.js`) includes all four authoring fields and `draftLastUpdatedAt`. The authoring panel is pre-populated from this data so counsel can continue a previous draft without a separate fetch.

---

## Relationship to Incident Reports

The `LegalCaseFile` and `IncidentReport` have a strict 1-to-1 relationship via `reportId`. A report can have at most one legal case. Consequences:

- The `LegalCaseFile` is included in the `fetchReportById` eager-load (alongside `EvidenceFile`), so the report API returns the current case state without an additional request.
- `toApiLegalCase` in `reportController.js` maps the database columns to the API response shape, including all four authoring fields.
- Resolution of the parent report automatically closes the legal case, so counsel cannot advance a case after the survivor's report is resolved.

---

## Security Notes

- `resolveCaseForCounsel` returns `null` (→ HTTP 404) for any case the calling counsel is not assigned to. This prevents unauthorized legal counsel from discovering that a case exists at all.
- The `generatedDocumentPath` (Cloudinary `public_id`) is included in the API response for completeness but has no value to a client — the only way to retrieve the document is through the authenticated streaming proxy endpoint.
- Cloudinary `type: authenticated` assets require server-side API credentials for all delivery. Guessing or constructing a direct Cloudinary URL will not work.
