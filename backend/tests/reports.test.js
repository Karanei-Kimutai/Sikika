const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

jest.mock("../src/config/cloudinary", () => ({
  isCloudinaryConfigured: jest.fn(() => false),
  uploadEvidenceBuffer: jest.fn(),
  generateEvidenceSignedUrl: jest.fn()
}));

jest.mock("../src/models", () => ({
  IncidentReport: {
    create: jest.fn()
  },
  EvidenceFile: {},
  LegalCaseFile: {
    findOne: jest.fn(),
    findOrCreate: jest.fn()
  },
  SurvivorProfile: {
    findOne: jest.fn(),
    findByPk: jest.fn()
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
  UserAccount: {
    findByPk: jest.fn()
  },
  InAppNotification: {
    create: jest.fn()
  }
}));

const {
  IncidentReport,
  SurvivorProfile,
  NgoAdministratorProfile,
  UserAccount,
  InAppNotification
} = require("../src/models");
const reportRoutes = require("../src/routes/reportRoutes");

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportRoutes);
  return app;
}

describe("Report submission routes", () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  });

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    UserAccount.findByPk.mockResolvedValue({
      userId: "user-survivor-1",
      userRole: "SURVIVOR",
      accountStatus: "ACTIVE"
    });

    SurvivorProfile.findOne.mockResolvedValue({
      survivorId: "survivor-1",
      userId: "user-survivor-1"
    });

    SurvivorProfile.findByPk.mockResolvedValue({
      survivorId: "survivor-1",
      userId: "user-survivor-1",
      assignedCounsellorId: null,
      assignedLegalCounselId: null
    });

    NgoAdministratorProfile.findAll.mockResolvedValue([{ userId: "ngo-admin-1" }]);
    InAppNotification.create.mockResolvedValue({});

    IncidentReport.create.mockResolvedValue({
      reportId: "report-new-1",
      survivorId: "survivor-1",
      incidentCategory: "domestic_violence",
      severityLevel: "HIGH",
      incidentDescriptionText: "A report body",
      incidentLocation: "Nairobi",
      incidentDate: "2026-06-10",
      currentReportStatus: "SUBMITTED",
      reportCreationTimestamp: "2026-06-11T09:00:00.000Z",
      evidenceFiles: []
    });
  });

  test("rejects unauthenticated report creation", async () => {
    const response = await request(app)
      .post("/api/reports")
      .send({
        category: "domestic_violence",
        severityLevel: "HIGH",
        description: "Need support"
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("registered and authenticated survivors");
  });

  test("allows authenticated survivor to create report and link to survivor profile", async () => {
    const token = makeToken({
      id: "user-survivor-1",
      userId: "user-survivor-1",
      role: "SURVIVOR"
    });

    const response = await request(app)
      .post("/api/reports")
      .set("Authorization", `Bearer ${token}`)
      .send({
        category: "domestic_violence",
        severityLevel: "HIGH",
        description: "A report body",
        location: "Nairobi",
        date: "2026-06-10"
      });

    expect(response.status).toBe(201);
    expect(response.body.report.reportId).toBe("report-new-1");
    expect(response.body.report.survivorId).toBe("survivor-1");

    expect(IncidentReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        survivorId: "survivor-1",
        incidentCategory: "domestic_violence",
        severityLevel: "HIGH"
      })
    );
  });
});
