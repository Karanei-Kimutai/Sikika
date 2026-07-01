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
    create: jest.fn()
  }
}));

const ussdRoutes = require("../src/routes/ussdRoutes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/ussd", ussdRoutes);
  return app;
}

describe("USSD webhook (POST /api/ussd/callback)", () => {
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
});
