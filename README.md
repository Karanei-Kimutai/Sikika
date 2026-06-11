# GBV Support Platform

This repository contains the full project workspace for the GBV Support Platform.

## Repository Structure

- `backend/` - Express + Sequelize API, authentication, reporting, chat/community, admin operations.
- `frontend/` - React + Vite client for public browsing, authentication, reporting, chat, community, and admin dashboards.
- `docs/` - supporting architecture, flow, and manual test documents.

## Quick Navigation

- Backend documentation: [backend/README.md](backend/README.md)
- Frontend documentation: [frontend/README.md](frontend/README.md)

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

- Environment configuration for backend and frontend is documented in the respective README files.
- Evidence/resource uploads require Cloudinary environment variables in backend configuration.
- This root README is intentionally concise; detailed implementation docs live in backend and frontend README files.
