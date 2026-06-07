/**
 * database.js
 * -----------
 * Sequelize connection instance configuration.
 *
 * This file creates and exports the single Sequelize instance that all
 * models and operations share. Connection parameters are loaded from
 * environment variables so that no credentials are hard-coded in source.
 *
 * Usage:
 *   const sequelize = require('./config/database');
 */

const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,      // Database name
  process.env.DB_USER,      // MySQL username
  process.env.DB_PASSWORD,  // MySQL password
  {
    host:    process.env.DB_HOST || 'localhost',
    port:    process.env.DB_PORT || 3306,
    dialect: 'mysql',

    // Connection pool settings — controls how many simultaneous
    // DB connections Sequelize can hold open at once.
    pool: {
      max:     10,   // Maximum number of connections in pool
      min:     0,    // Minimum number of connections in pool
      acquire: 30000, // Max ms to wait before throwing acquisition error
      idle:    10000  // Ms a connection can be idle before being released
    },

    // Disable Sequelize's query logging in production.
    // In development, set to console.log to see every SQL query.
    logging: process.env.NODE_ENV === 'development' ? console.log : false,

    define: {
      // Prevent Sequelize from auto-pluralising table names.
      // Our SQL schema already uses explicit table names.
      freezeTableName: true,

      // Disable the automatic createdAt / updatedAt columns that
      // Sequelize adds by default — our schema manages its own timestamps.
      timestamps: false
    }
  }
);

module.exports = sequelize;