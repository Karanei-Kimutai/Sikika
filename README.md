# GBV Support Platform

This repository contains the full project workspace for the GBV Support Platform.

## Repository Structure

- `backend/` — Express + Sequelize API, authentication, reporting, chat/community, admin operations, USSD.
- `frontend/` — React + Vite client for public browsing, authentication, reporting, chat, community, and admin dashboards.
- `docs/` — in-depth implementation documentation.

## Quick Navigation

- Backend: [backend/README.md](backend/README.md)
- Frontend: [frontend/README.md](frontend/README.md)

### Deep-dive docs

| Doc | What it covers |
|-----|---------------|
| [docs/authentication.md](docs/authentication.md) | Auth flows, OTP lifecycle, JWT, lockout, ban enforcement |
| [docs/server-bootup.md](docs/server-bootup.md) | Full server startup sequence, schema compatibility |
| [docs/ussd.md](docs/ussd.md) | USSD menu tree, Africa's Talking integration, ngrok local dev |
| [docs/cloudinary.md](docs/cloudinary.md) | File storage profiles, delivery architecture, proxy model |

## Local Development

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Notes

- Environment configuration is documented in the respective backend and frontend README files.
- All file uploads (evidence, support resources, legal case PDFs) are stored in Cloudinary. See [docs/cloudinary.md](docs/cloudinary.md) for the full storage and delivery model.
- USSD requires an Africa's Talking account and a public callback URL. See [docs/ussd.md](docs/ussd.md) for local dev setup with ngrok.
- This root README is intentionally concise; detailed implementation docs live in `docs/`.
