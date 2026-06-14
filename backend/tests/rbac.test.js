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
  SystemAdministratorProfile: {},
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

  test("denies survivor access to NGO admin dashboard", async () => {
    const token = makeToken({ id: "survivor-user", userId: "survivor-user", role: "SURVIVOR" });

    const response = await request(app)
      .get("/api/admin/ngo/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Insufficient permissions");
  });

  test("denies survivor access to another survivor report", async () => {
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
