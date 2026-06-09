const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
require("dotenv").config();
const authMiddleware = require("./src/middleware/authMiddleware");

for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  if (process.env[key] === "http://127.0.0.1:9") {
    delete process.env[key];
  }
}

const app = express();

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(cors({
  origin: frontendOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const authRoutes = require("./src/routes/authRoutes");

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Express backend!" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health/db", async (req, res) => {
  try {
    const db = require("./src/models");
    await db.sequelize.authenticate();
    res.json({ status: "ok", database: process.env.DB_NAME });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

app.use("/api/auth", authRoutes);

app.get("/api/auth/session", authMiddleware, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user
  });
});

const requiredEnv = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_USERNAME",
  "JWT_SECRET"
];

function validateEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (process.env.NODE_ENV === "production") {
    if (process.env.AFRICASTALKING_USERNAME === "sandbox") {
      throw new Error("Invalid production config: AFRICASTALKING_USERNAME cannot be 'sandbox' in production.");
    }

    if (process.env.SKIP_SMS_IN_DEV === "true") {
      throw new Error("Invalid production config: SKIP_SMS_IN_DEV must be false in production.");
    }
  }
}

function quoteIdentifier(identifier) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(process.env.DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function startServer() {
  try {
    validateEnv();
    await ensureDatabaseExists();

    const db = require("./src/models");

    await db.sequelize.authenticate();
    console.log("Database connected successfully!");

    await db.sequelize.sync({ alter: true });
    console.log("Database tables synced successfully!");

    const PORT = Number(process.env.PORT || 5000);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start backend:", err.message);
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("Check DB_USER and DB_PASSWORD in backend/.env. MySQL rejected these credentials.");
    }
    process.exit(1);
  }
}

startServer();
