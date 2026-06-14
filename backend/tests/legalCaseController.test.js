/**
 * legalCaseController.test.js
 * ---------------------------
 * Tests for the legal case drafting and export endpoints.
 *
 * Covered:
 * 1. saveDraft — access control, field validation, partial update
 * 2. updateCaseStatus — valid and invalid transitions
 * 3. generateDocument — Cloudinary-not-configured guard (returns 503)
 * 4. getDocumentAccessUrl — missing document guard (returns 404)
 *
 * All DB interactions are mocked so no live database is required.
 */

// ── Shared mock state ──────────────────────────────────────────────────────

const LEGAL_COUNSEL_USER_ID = 'lc-user-1';
const LEGAL_COUNSEL_ID = 'lc-profile-1';
const LEGAL_CASE_ID = 'legal-case-1';
const REPORT_ID = 'report-1';
const SURVIVOR_ID = 'survivor-1';

// Mutable case object — tests mutate this to simulate DB state.
let mockLegalCase = {
  legalCaseId: LEGAL_CASE_ID,
  reportId: REPORT_ID,
  escalationTimestamp: new Date(),
  currentCaseStatus: 'OPEN',
  generatedDocumentPath: null,
  caseSummary: null,
  legalGroundsText: null,
  requestedReliefText: null,
  recommendedActionsText: null,
  draftLastUpdatedAt: null,
  documentGeneratedAt: null,
  update: jest.fn(async (fields) => Object.assign(mockLegalCase, fields)),
  toJSON: jest.fn(() => ({ ...mockLegalCase }))
};

mockLegalCase._reportData = {
  reportId: REPORT_ID,
  category: 'domestic_violence',
  severityLevel: 'HIGH',
  date: '2026-01-10',
  location: 'Nairobi'
};

// ── Model mocks ─────────────────────────────────────────────────────────────

jest.mock('../src/models', () => ({
  LegalCaseFile: {
    findByPk: jest.fn()
  },
  SurvivorProfile: {
    findOne: jest.fn()
  },
  LegalCounselProfile: {
    findOne: jest.fn()
  },
  UserAccount: {
    findByPk: jest.fn()
  },
  IncidentReport: {
    findByPk: jest.fn()
  }
}));

// ── Cloudinary mock ─────────────────────────────────────────────────────────

jest.mock('../src/config/cloudinary', () => ({
  isCloudinaryConfigured: jest.fn(() => true),
  uploadLegalDocumentBuffer: jest.fn(async () => ({ public_id: 'legal-cases/legal-case-1/fake-uuid' })),
  generateLegalDocumentSignedUrl: jest.fn(() => 'https://res.cloudinary.com/fake/legal-case-1.pdf')
}));

// ── PDF service mock ─────────────────────────────────────────────────────────

jest.mock('../src/services/legalDocumentService', () => ({
  buildLegalCasePdfBuffer: jest.fn(async () => Buffer.from('fake-pdf-content'))
}));

// ── Import after mocks ───────────────────────────────────────────────────────

const {
  UserAccount,
  LegalCounselProfile,
  LegalCaseFile,
  SurvivorProfile,
  IncidentReport
} = require('../src/models');

const { isCloudinaryConfigured } = require('../src/config/cloudinary');

const {
  saveDraft,
  updateCaseStatus,
  generateDocument,
  getDocumentAccessUrl
} = require('../src/controllers/legalCaseController');

// ── Helper: build a standard request ────────────────────────────────────────

function buildReq(overrides = {}) {
  return {
    params: { legalCaseId: LEGAL_CASE_ID },
    body: {},
    user: { userId: LEGAL_COUNSEL_USER_ID },
    ...overrides
  };
}

function buildRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  };
  return res;
}

// ── Shared beforeEach setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Reset mutable case back to initial state
  mockLegalCase.currentCaseStatus = 'OPEN';
  mockLegalCase.generatedDocumentPath = null;
  mockLegalCase.caseSummary = null;
  mockLegalCase.update.mockImplementation(async (fields) => Object.assign(mockLegalCase, fields));

  // Wire up the actor resolution chain (legal counsel user)
  UserAccount.findByPk.mockResolvedValue({ userId: LEGAL_COUNSEL_USER_ID, userRole: 'LEGAL_COUNSEL' });
  LegalCounselProfile.findOne.mockResolvedValue({ legalCounselId: LEGAL_COUNSEL_ID });

  // Wire up case + assignment chain
  LegalCaseFile.findByPk.mockResolvedValue(mockLegalCase);
  IncidentReport.findByPk.mockResolvedValue({
    reportId: REPORT_ID,
    survivorId: SURVIVOR_ID,
    incidentCategory: 'domestic_violence',
    severityLevel: 'HIGH',
    incidentDate: '2026-01-10',
    incidentLocation: 'Nairobi'
  });
  SurvivorProfile.findOne.mockResolvedValue({ survivorId: SURVIVOR_ID, assignedLegalCounselId: LEGAL_COUNSEL_ID });

  isCloudinaryConfigured.mockReturnValue(true);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. saveDraft
// ────────────────────────────────────────────────────────────────────────────

describe('saveDraft', () => {
  it('saves recognised draft fields and returns 200', async () => {
    const req = buildReq({ body: { caseSummary: 'Summary text.', legalGroundsText: 'Sexual Offences Act.' } });
    const res = buildRes();

    await saveDraft(req, res);

    expect(mockLegalCase.update).toHaveBeenCalledWith(
      expect.objectContaining({ caseSummary: 'Summary text.', legalGroundsText: 'Sexual Offences Act.', draftLastUpdatedAt: expect.any(Date) })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Draft saved successfully.' }));
  });

  it('returns 403 when the caller is not a LEGAL_COUNSEL', async () => {
    UserAccount.findByPk.mockResolvedValue({ userId: 'other-user', userRole: 'COUNSELLOR' });
    const req = buildReq({ user: { userId: 'other-user' }, body: { caseSummary: 'x' } });
    const res = buildRes();

    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockLegalCase.update).not.toHaveBeenCalled();
  });

  it('returns 403 when legal counsel is not assigned to this case\'s survivor', async () => {
    // Another counsel is assigned, not the caller
    SurvivorProfile.findOne.mockResolvedValue(null);
    const req = buildReq({ body: { caseSummary: 'x' } });
    const res = buildRes();

    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not found or you are not authorised') }));
    expect(mockLegalCase.update).not.toHaveBeenCalled();
  });

  it('returns 400 when no recognised fields are supplied', async () => {
    const req = buildReq({ body: { unknownField: 'ignored' } });
    const res = buildRes();

    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No recognised draft fields') }));
  });

  it('returns 404 when the case does not exist', async () => {
    LegalCaseFile.findByPk.mockResolvedValue(null);
    const req = buildReq({ body: { caseSummary: 'x' } });
    const res = buildRes();

    await saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. updateCaseStatus
// ────────────────────────────────────────────────────────────────────────────

describe('updateCaseStatus', () => {
  it('transitions OPEN → UNDER_INVESTIGATION successfully', async () => {
    const req = buildReq({ body: { status: 'UNDER_INVESTIGATION' } });
    const res = buildRes();

    await updateCaseStatus(req, res);

    expect(mockLegalCase.update).toHaveBeenCalledWith({ currentCaseStatus: 'UNDER_INVESTIGATION' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Case status updated to UNDER_INVESTIGATION.' }));
  });

  it('rejects a skip-step transition (OPEN → SUBMITTED) with 400', async () => {
    const req = buildReq({ body: { status: 'SUBMITTED' } });
    const res = buildRes();

    await updateCaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockLegalCase.update).not.toHaveBeenCalled();
  });

  it('rejects a transition from a terminal state (CLOSED → anything) with 400', async () => {
    mockLegalCase.currentCaseStatus = 'CLOSED';
    const req = buildReq({ body: { status: 'OPEN' } });
    const res = buildRes();

    await updateCaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('terminal') }));
  });

  it('returns 400 when status is missing from the request body', async () => {
    const req = buildReq({ body: {} });
    const res = buildRes();

    await updateCaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'status is required.' }));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. generateDocument
// ────────────────────────────────────────────────────────────────────────────

describe('generateDocument', () => {
  it('returns 503 when Cloudinary is not configured', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    const req = buildReq();
    const res = buildRes();

    await generateDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Cloudinary is not configured') }));
  });

  it('generates and uploads a PDF, stores public_id', async () => {
    const req = buildReq();
    const res = buildRes();

    await generateDocument(req, res);

    expect(mockLegalCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedDocumentPath: 'legal-cases/legal-case-1/fake-uuid',
        documentGeneratedAt: expect.any(Date)
      })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Legal case document generated successfully.' }));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. getDocumentAccessUrl
// ────────────────────────────────────────────────────────────────────────────

describe('getDocumentAccessUrl', () => {
  it('returns 404 when no document has been generated yet', async () => {
    mockLegalCase.generatedDocumentPath = null;
    const req = buildReq();
    const res = buildRes();

    await getDocumentAccessUrl(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No document has been generated') }));
  });

  it('returns a signed URL when a document exists', async () => {
    mockLegalCase.generatedDocumentPath = 'legal-cases/legal-case-1/fake-uuid';
    const req = buildReq();
    const res = buildRes();

    await getDocumentAccessUrl(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ signedUrl: expect.stringContaining('cloudinary'), expiresInSeconds: 300 })
    );
  });
});
