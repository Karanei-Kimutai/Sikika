const request = require("supertest");
const express = require("express");

jest.mock("../src/models", () => ({
  UssdCallbackRequest: {
    create: jest.fn().mockResolvedValue({})
  },
  CounsellorProfile: {
    findOne: jest.fn().mockResolvedValue(null)
  },
  UserAccount: {
    findByPk: jest.fn().mockResolvedValue({
      userId: "ngo-admin-1",
      userRole: "NGO_ADMIN",
      accountStatus: "ACTIVE"
    }),
    // findAll is called in the best-effort notification path after a confirmed callback
    findAll: jest.fn().mockResolvedValue([])
  }
}));

// Notification service is best-effort in the USSD flow — mock to avoid real DB calls
jest.mock("../src/services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({}),
  createNotificationsBulk: jest.fn().mockResolvedValue([])
}));

const { UssdCallbackRequest } = require("../src/models");
const ussdRoutes = require("../src/routes/ussdRoutes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/ussd", ussdRoutes);
  return app;
}

describe("USSD webhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("starts a new session with a CON response", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_001",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000001",
        text: ""
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("CON ")).toBe(true);
  });

  test("handles callback request path and attempts persistence", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_002",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000001",
        text: "1"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("CON ")).toBe(true);
  });

  test("returns safe prompt for invalid top-level option", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_003",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000001",
        text: "9"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ") || response.text.startsWith("CON ")).toBe(true);
  });

  test("returns END when required fields are missing", async () => {
    const app = buildApp();

    // phoneNumber is required — missing it should produce a safe END, not a crash
    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_004",
        serviceCode: "*384*100#",
        text: ""
        // phoneNumber intentionally omitted
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
  });

  test("confirms callback (text='1*1') persists a record and returns END", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_005",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000005",
        text: "1*1"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
    expect(response.text).toContain("callback request has been received");
    // Verify the persistence call was made with the caller's phone number
    expect(UssdCallbackRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ requesterPhoneNumber: "+254711000005" })
    );
  });

  test("cancels callback (text='1*0') without persisting a record", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_006",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000006",
        text: "1*0"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
    expect(response.text).toContain("cancelled");
    // No DB record should be created for a cancellation
    expect(UssdCallbackRequest.create).not.toHaveBeenCalled();
  });

  test("returns emergency contacts (text='2') as a terminal END response", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_007",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000007",
        text: "2"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
    expect(response.text).toContain("999");
  });

  test("two concurrent sessions with different IDs receive independent welcome screens", async () => {
    const app = buildApp();

    const [responseA, responseB] = await Promise.all([
      request(app).post("/api/ussd/callback").send({
        sessionId: "ATUid_session_A",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000008",
        text: ""
      }),
      request(app).post("/api/ussd/callback").send({
        sessionId: "ATUid_session_B",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000009",
        text: ""
      })
    ]);

    // Both sessions start from the welcome screen independently
    expect(responseA.status).toBe(200);
    expect(responseA.text.startsWith("CON ")).toBe(true);
    expect(responseB.status).toBe(200);
    expect(responseB.text.startsWith("CON ")).toBe(true);
  });
});
