/**
 * sync.js
 * -------
 * Database synchronisation script.
 *
 * Connects to MySQL and creates all tables defined in the Sequelize models
 * if they do not already exist. Run this once during initial project setup,
 * or whenever new models are added.
 *
 * Usage:
 *   node src/sync.js
 *
 * Options:
 *   { force: true }  — DROP and recreate all tables. Destroys all data.
 *                      Use only in development when resetting the schema.
 *   { alter: true }  — Attempt to ALTER existing tables to match models.
 *                      Safer than force in development, but not for production.
 *   {}               — Create tables only if they do not exist. Safe for all envs.
 *
 * IMPORTANT: Never run with { force: true } in production.
 */

require('dotenv').config();
const { sequelize } = require('./models');

async function syncDatabase() {
  try {
    // Test that the connection to MySQL is working before attempting sync.
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Sync all models — create tables if they do not exist.
    // Change to { force: true } to reset schema in development only.
    await sequelize.sync({ alter: true });
    console.log('✅ All models synchronised to database.');

  } catch (error) {
    console.error('❌ Database sync failed:', error.message);
    process.exit(1);

  } finally {
    // Always close the connection after sync completes.
    await sequelize.close();
    console.log('🔒 Database connection closed.');
  }
}

syncDatabase();