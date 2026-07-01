# Sikika

A Gender-Based Violence (GBV) support platform for Kenya. Dual-channel (Web + USSD), survivor-centred, with six user roles: Survivor, Counsellor, Legal Counsel, Moderator, NGO Admin, and unregistered visitors.

**Stack:** React 19 · Node.js + Express 5 + Socket.io · MySQL + Sequelize · Africa's Talking (USSD + SMS OTP) · Cloudinary

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18 LTS |
| npm | 9 |
| MySQL | 8 |

---

## Environment Setup

**Backend** — copy `backend/.env.example` to `backend/.env` and fill:

| Variable | Notes |
|----------|-------|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
| `JWT_SECRET` | Run `openssl rand -base64 64` and paste the output |
| `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME` | Use `"sandbox"` username for local dev |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional; upload endpoints return 503 without these |
| `SKIP_SMS_IN_DEV=true` | Returns OTP in the API response instead of sending SMS |
| `DB_SYNC_ALTER=false` | Stable schema in dev; set to `true` once when adding columns |
| `ENABLE_SCHEMA_COMPAT=true` | Boot-time ENUM reconciliation guards |

**Frontend** — create `frontend/.env`:

```
VITE_API_BASE_URL=http://localhost:5000
```

---

## Quick Start

```bash
# Terminal 1 — backend (hot reload on port 5000)
cd backend && npm install && npm run dev

# Terminal 2 — frontend (Vite dev server on port 5173)
cd frontend && npm install && npm run dev
```

Seed demo data (DESTRUCTIVE — drops and recreates all tables):

```bash
cd backend && node src/seeders/index.js
```

---

## Demo Credentials

| Role | Phone | Password |
|------|-------|----------|
| Survivor | +254711000001 | Survivor@2026! |
| Counsellor | +254700000020 | Counsellor@2026! |
| Legal Counsel | +254700000030 | LegalCounsel@2026! |
| NGO Admin | +254700000010 | NgoAdmin@2026! |
| Moderator | +254700000001 | Moderator@2026! |

---

## Repository Structure

- `backend/` — Express + Sequelize API, auth, chat, reporting, USSD, admin, community
- `frontend/` — React 19 SPA, custom router (no React Router), prop-drilling state model
- `docs/` — module-level implementation documentation (see index below)

---

## Documentation

**[docs/index.md](docs/index.md)** — master table of contents organized by module and feature. Start here to find documentation for any part of the system.

### Quick links by module

| Module | Primary doc |
|--------|-------------|
| Authentication & Sessions | [docs/authentication.md](docs/authentication.md) |
| Direct Chat (E2EE) | [docs/direct-chat.md](docs/direct-chat.md) · [docs/e2ee.md](docs/e2ee.md) |
| Community Chat & Rooms | [docs/community-moderation.md](docs/community-moderation.md) |
| Community Moderation | [docs/community-moderation.md](docs/community-moderation.md) |
| Incident Reporting | [docs/reporting.md](docs/reporting.md) |
| Legal Cases | [docs/legal-cases.md](docs/legal-cases.md) |
| Resource Library | [docs/resource-management.md](docs/resource-management.md) |
| USSD | [docs/ussd.md](docs/ussd.md) |
| Notifications | [docs/notifications.md](docs/notifications.md) |
| NGO Admin Dashboard | [docs/admin-dashboard.md](docs/admin-dashboard.md) |
| Roles & Permissions | [docs/rbac.md](docs/rbac.md) |
| Real-time / Sockets | [docs/sockets.md](docs/sockets.md) |
| File Storage | [docs/cloudinary.md](docs/cloudinary.md) |
| Data Models (ERD) | [docs/data-model.md](docs/data-model.md) |
| Frontend Architecture | [docs/frontend-architecture.md](docs/frontend-architecture.md) |
| Server Boot Process | [docs/server-bootup.md](docs/server-bootup.md) |
| REST API Reference | [docs/api-reference.md](docs/api-reference.md) |
| Deployment | [docs/deployment.md](docs/deployment.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Glossary | [docs/glossary.md](docs/glossary.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
