# Incident Reporting

This document covers the incident reporting module: how survivors submit reports, how staff advance them through the workflow, the evidence upload mechanism, and the full status state machine.

---

## Overview

The reporting module is Sikika's primary structured channel for survivors to document incidents and engage the support network. A report travels through a defined lifecycle from initial submission through counsellor/legal review to resolution or withdrawal.

Key design principles:

- **Survivor-controlled.** Only survivors can create, edit, withdraw, or delete their own reports.
- **Assignment-scoped staff access.** Counsellors and legal counsel see only reports belonging to survivors currently assigned to them.
- **NGO Admin visibility.** NGO admins see all reports and can advance status across all stages.
- **Explicit state machine.** Status transitions are validated server-side against a transition table and a per-role permission table.
- **Survivor consent for legal escalation.** The transition to `ESCALATED_TO_LEGAL_CASE` requires `survivorConsent: true` in the request body and can only be performed by `LEGAL_COUNSEL`.
- **Evidence stays private.** Evidence files are stored as private Cloudinary assets and delivered only through a backend streaming proxy. Cloudinary URLs never reach the browser.

---

## Status State Machine

Reports progress through seven states. Terminal states (`RESOLVED`, `WITHDRAWN`) accept no further transitions.

```
SUBMITTED
  └─► UNDER_REVIEW
        ├─► ACTIVE_SUPPORT
        │     ├─► UNDER_INVESTIGATION
        │     │     ├─► LEGAL_REVIEW
        │     │     │     ├─► ESCALATED_TO_LEGAL_CASE → RESOLVED
        │     │     │     ├─► ACTIVE_SUPPORT (return)
        │     │     │     ├─► RESOLVED
        │     │     │     └─► WITHDRAWN
        │     │     ├─► RESOLVED
        │     │     └─► WITHDRAWN
        │     ├─► LEGAL_REVIEW (direct)
        │     ├─► RESOLVED
        │     └─► WITHDRAWN
        ├─► UNDER_INVESTIGATION (skip active support)
        └─► WITHDRAWN
```

The transition table is defined in `STATUS_TRANSITIONS` in `reportController.js`:

```
SUBMITTED            → [UNDER_REVIEW, WITHDRAWN]
UNDER_REVIEW         → [ACTIVE_SUPPORT, UNDER_INVESTIGATION, WITHDRAWN]
ACTIVE_SUPPORT       → [UNDER_INVESTIGATION, LEGAL_REVIEW, RESOLVED, WITHDRAWN]
UNDER_INVESTIGATION  → [LEGAL_REVIEW, RESOLVED, WITHDRAWN]
LEGAL_REVIEW         → [ESCALATED_TO_LEGAL_CASE, ACTIVE_SUPPORT, RESOLVED, WITHDRAWN]
ESCALATED_TO_LEGAL_CASE → [RESOLVED]
RESOLVED             → []
WITHDRAWN            → []
```

### Role-Scoped Transition Permissions

Even when a transition is structurally valid, only certain roles may set each target status:

| Role | Allowed Target Statuses |
|---|---|
| `SURVIVOR` | *(none — survivors use the withdrawReport endpoint instead)* |
| `COUNSELLOR` | `ACTIVE_SUPPORT`, `UNDER_INVESTIGATION`, `RESOLVED` |
| `LEGAL_COUNSEL` | `LEGAL_REVIEW`, `ESCALATED_TO_LEGAL_CASE`, `RESOLVED` |
| `NGO_ADMIN` | `UNDER_REVIEW`, `ACTIVE_SUPPORT`, `UNDER_INVESTIGATION`, `LEGAL_REVIEW`, `RESOLVED` |

Both guards — `STATUS_TRANSITIONS` validity and `STATUS_UPDATE_PERMISSIONS` role check — must pass for a transition to succeed. A counsellor cannot set `LEGAL_REVIEW` even though the transition table permits it from `ACTIVE_SUPPORT`.

---

## Report Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `category` | string | yes | Incident category (free text) |
| `severityLevel` | enum | yes | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `description` | string | yes | Full incident description |
| `location` | string | no | Geographic location of incident |
| `date` | date | no | Date of incident (may differ from submission date) |

Reports are editable by the survivor only while `currentReportStatus === "SUBMITTED"`. Once staff begin review the report is locked for content changes.

---

## REST Endpoints

### Creating a Report

`POST /api/reports` — `SURVIVOR` only.

Creates the report in `SUBMITTED` status and notifies all stakeholders with a `NEW_SUBMISSION` notification.

### Listing Reports

`GET /api/reports` — all authenticated roles.

Scope is automatically narrowed by role:
- **Survivor:** own reports only.
- **Counsellor:** reports for survivors currently assigned to this counsellor.
- **Legal Counsel:** reports for survivors currently assigned to this legal counsel.
- **NGO Admin:** all reports.

Supports query filters: `?status=`, `?category=`, `?severityLevel=`.

### Getting a Report

`GET /api/reports/:reportId`

Returns the full report with nested `evidence` array and `legalCase` object.

### Editing a Report (Survivor Only)

`PATCH /api/reports/:reportId` — `SURVIVOR`, own report, `SUBMITTED` status only.

Partial update — only provided fields are changed.

### Updating Report Status (Staff Only)

`PATCH /api/reports/:reportId/status` — `COUNSELLOR`, `LEGAL_COUNSEL`, or `NGO_ADMIN`.

Body: `{ reportStatus: string }`

Additional body fields for specific transitions:
- `survivorConsent: true` — **required** when `reportStatus` is `ESCALATED_TO_LEGAL_CASE`.
- `generatedDocumentPath` — optional Cloudinary public_id to pre-populate on the associated `LegalCaseFile`.

On `LEGAL_REVIEW` or `ESCALATED_TO_LEGAL_CASE`, `ensureLegalCaseForWorkflow` idempotently creates (or updates) the associated `LegalCaseFile` row:
- `LEGAL_REVIEW` → sets `currentCaseStatus = "UNDER_INVESTIGATION"`.
- `ESCALATED_TO_LEGAL_CASE` → sets `currentCaseStatus = "READY_FOR_SUBMISSION"` and updates `escalationTimestamp`.

On `RESOLVED`, any open `LegalCaseFile` linked to the report is automatically closed (`currentCaseStatus = "CLOSED"`).

### Withdrawing a Report (Survivor Only)

`PATCH /api/reports/:reportId/withdraw` — `SURVIVOR`, own report.

Requires `{ confirmWithdraw: true }` in the request body. If absent or false, returns HTTP 400 with a warning message recommending emergency contacts. This prevents accidental withdrawal.

### Deleting a Report (Survivor Only)

`DELETE /api/reports/:reportId` — `SURVIVOR`, own report.

Requires `{ confirmWithdraw: true }`. Hard-deletes the row and all cascading children.

### Uploading Evidence

`POST /api/reports/:reportId/evidence` — `SURVIVOR`, own report.

Accepts a multipart file upload. Supported MIME types:
- Images: `image/*`
- PDF: `application/pdf`
- Audio: `audio/*`

The file is uploaded to Cloudinary as a private asset. The Cloudinary `public_id` is stored in `EvidenceFile.cloudinaryPublicIdentifier`. Delivery is via the streaming proxy only.

### Streaming Evidence

`GET /api/reports/:reportId/evidence/:evidenceId/file` — any authenticated role with report access.

Backend fetches the file from Cloudinary using API credentials and pipes the bytes to the HTTP response. Cloudinary URLs never reach the browser.

Response headers:
- `Content-Disposition: inline; filename="<safeName>"`
- `Content-Type: <mime type>`
- `Content-Length: <bytes>` (when available)

### Reporting Analytics (NGO Admin Only)

`GET /api/reports/analytics` — `NGO_ADMIN` only.

Returns aggregate breakdowns used by the dashboard command center:
- `summary`: totalReports, openReports, resolvedReports, withdrawnReports
- `byStatus`: count per status value
- `byCategory`: count per incident category
- `bySeverity`: count per severity level
- `byCounty`: count per survivor's residenceCounty
- `trendByIncidentDate`: count per incident date (for trend charts)
- `legalCasesByStatus`: count per legal case status

Supports optional date filters: `?startDate=` and `?endDate=`.

---

## Unauthenticated Reporter Intercept

`/reports` is **not a protected route**. Unregistered visitors who navigate to the reporting URL see `UnauthReportIntercept.jsx`, which displays emergency contacts:

- Police emergency: 999 / 112
- Childline Kenya: 116
- National GBV Hotline: 1195

On the backend, `createReport` returns a structured emergency-contacts response (HTTP 401) when no actor context is found.

---

## Evidence Security Model

- **Upload:** Cloudinary `type: authenticated`, stored under `evidence/<reportId>/` folder path.
- **No browser-accessible URLs:** `dynamicallySignedUrl` column is always stored as `""`. Cloudinary account-level settings block public signed URL delivery.
- **Proxy-only access:** `GET /api/reports/:reportId/evidence/:evidenceId/file` is the only delivery path. It requires a valid JWT and verifies report access before streaming.
- **Role access:** The same `canActorAccessReport` guard used for all report reads applies to evidence streaming.
- **Graceful degradation:** When Cloudinary env vars are absent, upload and streaming endpoints return HTTP 503; list endpoints still work normally.

---

## Notification Behavior

`notifyStakeholders` fans out notifications to the survivor, the assigned counsellor, the assigned legal counsel, and all NGO admins. The actor who triggered the change is excluded from staff notifications.

| Event | Survivor message | Staff message | Category |
|---|---|---|---|
| Report created | *(none)* | "A new submission requires attention" | `NEW_SUBMISSION` |
| Report content edited | *(none)* | "A request has been updated" | `REPORT_UPDATE` |
| Status updated | "Your request has been updated" | "A request status has been updated" | `REPORT_UPDATE` |
| Evidence uploaded | *(none)* | "New files were added to a request" | `REPORT_UPDATE` |
| Report withdrawn | *(none)* | "A request has been withdrawn" | `REPORT_UPDATE` |

---

## Data Model

### `IncidentReport`

| Column | Type | Notes |
|---|---|---|
| `reportId` | `VARCHAR(36)` PK | UUID |
| `survivorId` | `VARCHAR(36)` FK | → SurvivorProfile |
| `incidentCategory` | `STRING` | Free-text category |
| `severityLevel` | `ENUM` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `incidentDescriptionText` | `TEXT` | Full incident description |
| `incidentLocation` | `STRING` | Optional geographic location |
| `incidentDate` | `DATE` | Date incident occurred |
| `currentReportStatus` | `ENUM` | 7-state lifecycle value |
| `reportCreationTimestamp` | `DATE` | Auto-set at creation |

### `EvidenceFile`

| Column | Type | Notes |
|---|---|---|
| `evidenceFileId` | `VARCHAR(36)` PK | UUID |
| `reportId` | `VARCHAR(36)` FK | → IncidentReport |
| `evidenceFileType` | `ENUM` | `image`, `pdf`, `audio` |
| `originalFileName` | `STRING` | Preserved from upload |
| `fileSize` | `INTEGER` | Bytes |
| `mimeType` | `STRING` | MIME type from upload |
| `cloudinaryPublicIdentifier` | `STRING` | Cloudinary public_id for proxy fetch |
| `dynamicallySignedUrl` | `STRING` | Always `""` — delivery via proxy only |
| `fileUploadTimestamp` | `DATE` | Auto-set |

---

## Frontend Integration

### `ReportingPage.jsx`

Role-branched view:

| Role | View rendered |
|---|---|
| Unauthenticated | `UnauthReportIntercept` — emergency contacts |
| `SURVIVOR` | `SurvivorReportView` — submit + manage own reports |
| `COUNSELLOR` | `StaffReportView` — read assigned reports, advance status |
| `LEGAL_COUNSEL` | `LegalCounselView` — legal review + case authoring panel |
| `NGO_ADMIN` | `StaffReportView` — full report list and all transitions |

### `StaffReportView` status dropdown (`frontend/src/utils/reportStatusRules.js`)

The status-update dropdown shown to `COUNSELLOR`, `LEGAL_COUNSEL`, and `NGO_ADMIN` no longer lists all 8 statuses unconditionally — `getAllowedNextStatuses(currentStatus, role)` in `reportStatusRules.js` mirrors the backend's `STATUS_TRANSITIONS` + `STATUS_UPDATE_PERMISSIONS` (see "Status State Machine" and "Role-Scoped Transition Permissions" above) to compute, client-side, exactly which target statuses are both **reachable** from the report's current status and **permitted** for the signed-in role. States with no further options render as plain text instead of a dead dropdown.

This is a UX mirror only — the backend remains the sole source of truth and re-validates every transition server-side regardless of what the dropdown offers. Keep `reportStatusRules.js`'s two maps in sync with `reportController.js`'s `STATUS_TRANSITIONS`/`STATUS_UPDATE_PERMISSIONS` if the workflow changes. Before this existed, a rejected transition (the backend correctly returning 409) still left the dropdown showing the picked-but-rejected status, which could look like the update had gone through; a rejected update now reverts the displayed status instead.

### `LegalCounselView.jsx`

Extends `StaffReportView` with the legal case authoring panel visible when a report is in `LEGAL_REVIEW` or `ESCALATED_TO_LEGAL_CASE`:

- Four structured text fields: Case Summary, Legal Grounds, Requested Relief, Recommended Actions.
- **Save Draft** — `PATCH /api/legal-cases/:legalCaseId`
- **Generate Document** — `POST /api/legal-cases/:legalCaseId/document`
- **Open Document** — `GET /api/legal-cases/:legalCaseId/document` (streaming proxy)

### `useReportHighlight.js`

Hook that reads `?highlight=<reportId>` from the URL and scrolls the matching report card into view on mount. Used for deep-linking from notification clicks.

---

## Status Normalization

The backend applies `normalizeStatus()` to incoming status values, handling legacy aliases:

- `"PENDING_REVIEW"` → `"UNDER_REVIEW"`
- `"IN_PROGRESS"` → `"ACTIVE_SUPPORT"`
- `"ESCALATED"` → `"ESCALATED_TO_LEGAL_CASE"`

This ensures older seeded data and clients using legacy names still work without a migration.
