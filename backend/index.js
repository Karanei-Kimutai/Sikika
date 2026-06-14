const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const authMiddleware = require("./src/middleware/authMiddleware");
const { maintenanceGuard, getMaintenanceModeState, loadMaintenanceStateFromDb } = require("./src/controllers/adminController");
const { setNotificationIo } = require("./src/services/notificationService");
const { ensureSchemaCompatibility } = require("./src/utils/schemaCompatibility");

/**
 * Backend bootstrap file.
 *
 * Responsibilities:
 * - Load environment/configuration
 * - Configure middleware and routes
 * - Validate required environment variables
 * - Ensure MySQL database exists
 * - Connect and sync Sequelize models
 * - Configure Websocket relay for E2EE chat
 * - Start HTTP server
 */

/**
 * Some local execution environments inject proxy variables that point to an
 * intentionally closed proxy address. Removing those placeholders prevents
 * third-party SDKs, such as Africa's Talking, from trying to use a dead proxy.
 */
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  if (process.env[key] === "http://127.0.0.1:9") {
    delete process.env[key];
  }
}

const app = express();

/**
 * We wrap the Express app in a standard Node HTTP server.
 * This allows both Express (REST) and Socket.io (WebSockets) to 
 * share the exact same port and runtime instance.
 */
const server = http.createServer(app);

/**
 * FRONTEND_ORIGIN is a backend setting even though it names the frontend:
 * Express needs it to decide which browser origin is allowed to call this API.
 */
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// Configure Socket.io with the same CORS policy as Express
const io = new Server(server, {
  cors: {
    origin: frontendOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  }
});

// Initialize the WebSocket event listeners for the chat relay
require("./src/sockets/chatSocket")(io);
require("./src/sockets/communitySocket")(io);
app.locals.io = io;
// Wire io into the notification service so real-time push works in controllers.
setNotificationIo(io);
// CORS is configured before routes so every endpoint receives the same policy.
app.use(cors({
  origin: frontendOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Parse JSON request bodies before route handlers access req.body.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Global maintenance enforcement is applied before business routes.
app.use(maintenanceGuard);

const authRoutes = require("./src/routes/authRoutes");
const resourceRoutes = require("./src/routes/resourceRoutes");
const chatRoutes = require("./src/routes/chatRoutes");
const reportRoutes = require("./src/routes/reportRoutes");
const communityRoutes = require("./src/routes/communityRoutes");
const adminRoutes = require("./src/routes/adminRoutes");
const profileRoutes = require("./src/routes/profileRoutes");
const reassignmentRequestRoutes = require("./src/routes/reassignmentRequestRoutes");
const ussdRoutes = require("./src/routes/ussdRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const legalCaseRoutes = require("./src/routes/legalCaseRoutes");

// Lightweight API smoke-test endpoint.
app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Express backend!" });
});

// Process-level health check. This confirms Express is reachable.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Public status endpoint used by frontend to show a maintenance screen.
app.get("/api/system/public-status", (req, res) => {
  res.json({ maintenanceMode: getMaintenanceModeState() });
});

// Database health check. This is useful when Express starts but MySQL is uncertain.
app.get("/api/health/db", async (req, res) => {
  try {
    const db = require("./src/models");
    await db.sequelize.authenticate();
    res.json({ status: "ok", database: process.env.DB_NAME });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Public and auth routes are mounted after shared middleware.
app.use("/api/auth", authRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/reassignment-requests", reassignmentRequestRoutes);
app.use("/api/ussd", ussdRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/legal-cases", legalCaseRoutes);

/**
 * Session inspection endpoint.
 *
 * authMiddleware verifies the JWT and attaches decoded user information to
 * req.user. The route simply reports the authenticated session payload.
 */
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

/**
 * Validate required configuration before opening the HTTP port.
 *
 * Failing fast here is easier to debug than letting the server start with a
 * missing DB connection, missing SMS provider credentials, or unsafe production
 * SMS settings.
 */
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

/**
 * Safely quote DB identifiers to avoid SQL syntax issues and injection risks.
 * This is used only for database names, not for values. Values still belong in
 * parameterized queries.
 */
function quoteIdentifier(identifier) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

/**
 * Create the configured database if it does not yet exist.
 *
 * Sequelize connects to DB_NAME later. This helper first connects to the MySQL
 * server itself so new developers do not have to manually create the database
 * before starting the backend.
 */
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

/**
 * Validate config, initialize DB, then start the Express server.
 *
 * Boot order matters:
 * 1. Validate env so startup fails with a clear message.
 * 2. Create DB_NAME when the MySQL user has permission.
 * 3. Authenticate Sequelize against the configured database.
 * 4. Sync models, then listen for HTTP traffic.
 */
async function startServer() {
  try {
    validateEnv();
    await ensureDatabaseExists();

    const db = require("./src/models");

    await db.sequelize.authenticate();
    console.log("Database connected successfully!");

    // `alter: true` can repeatedly create/index constraints across restarts in
    // mutable dev databases and eventually hit MySQL max-key limits. Keep
    // default startup sync non-destructive, with optional alter mode by env.
    const enableAlterSync = process.env.DB_SYNC_ALTER === "true";
    await db.sequelize.sync(enableAlterSync ? { alter: true } : undefined);
    console.log("Database tables synced successfully!");

    // Reconcile schema drift in legacy/local databases without a migration runner.
    await ensureSchemaCompatibility(db.sequelize);
    console.log("Schema compatibility checks completed.");

    // Restore durable settings (maintenance mode) from DB after tables exist.
    await loadMaintenanceStateFromDb();

    const PORT = Number(process.env.PORT || 5000);
    //We use server.listen, not app.listen, because Socket.io is attached to the server instance.
    server.listen(PORT, () => {
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
