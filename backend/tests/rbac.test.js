/**
 * rbac.test.js
 * ------------
 * Smoke tests for role-based access control enforcement on the REST API.
 *
 * These tests verify that the authMiddleware + role-guard combination correctly
 * rejects callers whose role does not match the required permission for an endpoint.
 * They are intentionally broad — one test per denial scenario — and do not exhaustively
 * cover every endpoint. Detailed per-endpoint access control is tested alongside the
 * controller in the relevant test file (e.g. banEnforcement.test.js, banCascade.test.js).
 *
 * Covered:
 * - A SURVIVOR token is denied access to the NGO Admin dashboard (role guard: NGO_ADMIN only).
 * - A SURVIVOR token cannot read another survivor's incident report (ownership guard).
 *
 * All DB models and Cloudinary are mocked. A real JWT is signed with the test secret so
 * that authMiddleware can verify it without bypassing the auth check.
 */

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

jest.mock("../src/config/cloudinary", () => ({
  isCloudinaryConfigured: jest.fn(() => false),
  uploadEvidenceBuffer: jest.fn(),
  generateEvidenceSignedUrl: jest.fn()
}));

jest.mock("../src/models", () => ({
  UserAccount: {
    findByPk: jest.fn()
  },
  IncidentReport: {
    findByPk: jest.fn()
  },
  EvidenceFile: {},
  LegalCaseFile: {},
  SurvivorProfile: {
    findOne: jest.fn()
  },
  CounsellorProfile: {
    findByPk: jest.fn(),
    findOne: jest.fn()
  },
  LegalCounselProfile: {
    findByPk: jest.fn(),
    findOne: jest.fn()
  },
  NgoAdministratorProfile: {
    findAll: jest.fn()
  },
  InAppNotification: {
    create: jest.fn()
  },
  sequelize: {},
  HarmfulContentReport: {},
  CommunityMessage: {},
  CommunityRoom: {},
  RoomMembership: {},
  DirectChatChannel: {},
  DirectChatMessage: {},
  LegalCaseFile: {},
  ModeratorProfile: {},
  AuditLog: {},
  SupportResource: {},
  StaffAssignmentHistory: {},
  ResourceAccessEvent: {}
}));

const { UserAccount, IncidentReport, SurvivorProfile } = require("../src/models");
const reportRoutes = require("../src/routes/reportRoutes");
const adminRoutes = require("../src/routes/adminRoutes");

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportRoutes);
  app.use("/api/admin", adminRoutes);
  return app;
}

describe("RBAC API protections", () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  });

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    UserAccount.findByPk.mockImplementation(async (userId) => ({
      userId,
      userRole: "SURVIVOR",
      accountStatus: "ACTIVE"
    }));

    SurvivorProfile.findOne.mockResolvedValue({
      survivorId: "survivor-a",
      userId: "survivor-user"
    });
  });

  test("returns 403 Insufficient permissions when a SURVIVOR token is used to call the NGO admin dashboard endpoint", async () => {
    const token = makeToken({ id: "survivor-user", userId: "survivor-user", role: "SURVIVOR" });

    const response = await request(app)
      .get("/api/admin/ngo/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Insufficient permissions");
  });

  test("returns 403 when a SURVIVOR tries to read an incident report that belongs to a different survivor", async () => {
    const token = makeToken({ id: "survivor-user", userId: "survivor-user", role: "SURVIVOR" });

    IncidentReport.findByPk.mockResolvedValue({
      reportId: "report-1",
      survivorId: "survivor-b",
      evidenceFiles: []
    });

    const response = await request(app)
      .get("/api/reports/report-1")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("do not have access");
  });
});
