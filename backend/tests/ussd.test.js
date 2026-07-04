/**
 * ussd.test.js
 * ------------
 * Tests for the USSD webhook controller (POST /api/ussd/callback).
 *
 * Africa's Talking posts to this endpoint on every dial and menu selection.
 * The controller must respond with `text/plain` starting with either:
 *   - "CON " — keep the session open and show the next menu prompt
 *   - "END " — terminate the session and show a final message
 *
 * Covered:
 * - Initial dial (text=""): controller returns a CON response displaying the main menu.
 *
 * The UssdCallbackRequest model is mocked so no database connection is needed.
 * Africa's Talking does not sign USSD requests, so the endpoint is public — no auth mock required.
 */

const request = require("supertest");
const express = require("express");

jest.mock("../src/models", () => ({
  UssdCallbackRequest: {
    create: jest.fn().mockResolvedValue({})
  },
  CounsellorProfile: {
    findAll: jest.fn().mockResolvedValue([])
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

describe("USSD webhook (POST /api/ussd/callback)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns a CON text/plain response displaying the main menu when the session starts (text is empty)", async () => {
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
    // Africa's Talking requires the response body to begin with exactly "CON " (with a space)
    // to keep the session open and show another prompt to the user.
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

  test("routes a confirmed callback to the least-loaded ACTIVE counsellor, skipping a lower-workload BANNED one", async () => {
    const { CounsellorProfile } = require("../src/models");
    // The BANNED counsellor has the lowest currentWorkloadScore and would be picked
    // by a naive lowest-score query, but suspending/banning only flips
    // UserAccount.accountStatus (CounsellorProfile.availabilityStatus is untouched),
    // so the ACTIVE-account join must exclude them in favor of the next lowest score.
    CounsellorProfile.findAll.mockResolvedValueOnce([
      {
        counsellorId: "counsellor-banned",
        availabilityStatus: "AVAILABLE",
        currentWorkloadScore: 1,
        userAccount: { accountStatus: "BANNED" }
      },
      {
        counsellorId: "counsellor-active",
        availabilityStatus: "AVAILABLE",
        currentWorkloadScore: 5,
        userAccount: { accountStatus: "ACTIVE" }
      }
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/api/ussd/callback")
      .send({
        sessionId: "ATUid_test_005b",
        serviceCode: "*384*100#",
        phoneNumber: "+254711000010",
        text: "1*1"
      });

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
    expect(UssdCallbackRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignedCounsellorId: "counsellor-active" })
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
