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

describe("USSD webhook", () => {
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
});
