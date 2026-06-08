# Backend

Node.js + Express backend with Sequelize (MySQL).

## Prerequisites

- Node.js 18+
- npm
- MySQL 8+

## Install

```bash
npm install
```

## Environment Variables

Copy the example file and update values:

```bash
cp .env.example .env
```

Expected variables:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

## Database

### 1. Create the database

Create the database configured in `.env` (example uses `CSProjectDB`).

```sql
CREATE DATABASE CSProjectDB;
```

### 2. Synchronize models to MySQL

This authenticates and syncs Sequelize models using `alter: true` in [src/sync.js](src/sync.js).

```bash
node src/sync.js
```

### 3. Seed development data

Seeder script in [src/seeders/index.js](src/seeders/index.js):

```bash
node src/seeders/index.js
```

Important:
- The seeder runs with `force: true` and will drop/recreate tables before inserting data.
- Use seeding only in development environments.

## Run Server

Production mode:

```bash
npm start
```

Development mode (auto-reload):

```bash
npm run dev
```

## Project Commands Summary

- `npm install` - install dependencies
- `node src/sync.js` - sync DB schema from models
- `node src/seeders/index.js` - reset DB and seed test data
- `npm start` - start backend server
- `npm run dev` - run backend with nodemon
