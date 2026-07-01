# Deployment Guide

This guide covers production deployment of the Sikika GBV Support Platform: server configuration, process management, Nginx setup (including WebSocket proxying), SSL, Africa's Talking live API migration, and a pre-launch checklist.

---

## Architecture Overview

```
Internet → Nginx (SSL termination + reverse proxy)
                 ↓ HTTP + WebSocket upgrade
           Node.js / Express + Socket.io (PM2, port 5000)
                 ↓
           MySQL 8 (local or managed RDS)
                 ↓ (file storage)
           Cloudinary (private authenticated assets)
```

All WebSocket (`ws://`) traffic rides the same port as HTTP (`5000`) because Socket.io is attached to the Node `http.Server` instance. Nginx proxies both protocols via a single upstream block.

---

## System Requirements

| Tool | Minimum version |
|------|----------------|
| Node.js | 18 LTS |
| npm | 9 |
| MySQL | 8.0 |
| Nginx | 1.18 |
| PM2 | 5.x |
| Certbot / acme.sh | (any) |

---

## Step 1 — Application Setup

```bash
# Clone and install
git clone <repo-url> /opt/sikika
cd /opt/sikika

# Backend
cd backend && npm ci --omit=dev

# Frontend (build static files)
cd ../frontend && npm ci && npm run build
# Output → frontend/dist/
```

---

## Step 2 — Environment Configuration

### Backend (`backend/.env`)

Copy `.env.example` and set every required variable:

```env
# Database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=SikikaDB
DB_USER=sikika
DB_PASSWORD=<strong-password>

# Security
JWT_SECRET=<64-byte-base64-from-openssl-rand-base64-64>

# Africa's Talking — LIVE credentials
AFRICASTALKING_API_KEY=<live-api-key>
AFRICASTALKING_USERNAME=<live-at-username>   # NOT "sandbox"

# Cloudinary
CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>

# Node
NODE_ENV=production
PORT=5000
FRONTEND_ORIGIN=https://yourdomain.com

# Schema — safe defaults for production
DB_SYNC_ALTER=false
ENABLE_SCHEMA_COMPAT=true

# OTP — must NOT be "true" in production
SKIP_SMS_IN_DEV=false
```

**Never commit `.env` files. Use restricted file permissions:**

```bash
chmod 600 backend/.env
```

### Frontend (`frontend/.env`)

```env
VITE_API_BASE_URL=https://yourdomain.com
```

Rebuild the frontend after changing `.env`:

```bash
cd frontend && npm run build
```

---

## Step 3 — Database

```sql
CREATE DATABASE SikikaDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sikika'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON SikikaDB.* TO 'sikika'@'localhost';
FLUSH PRIVILEGES;
```

The backend creates the database automatically if it does not exist (`ensureDatabaseExists()` in `index.js`), but pre-creating it with explicit character set avoids implicit defaults.

Run the seeder only in staging, never in production (it drops all tables):

```bash
# STAGING ONLY
cd backend && node src/seeders/index.js
```

---

## Step 4 — PM2 Process Manager

PM2 manages the Node.js process: starts on boot, auto-restarts on crash, aggregates logs.

```bash
npm install -g pm2
```

Create `backend/ecosystem.config.js`:

```js
module.exports = {
  apps: [{
    name: 'sikika-backend',
    script: 'index.js',
    cwd: '/opt/sikika/backend',
    env: { NODE_ENV: 'production' },
    instances: 1,            // Socket.io in-memory state; do not run multiple without Redis adapter
    kill_timeout: 5000,      // Give shutdown handler time to drain connections
    watch: false,
    max_memory_restart: '512M'
  }]
};
```

**Important:** Run a single PM2 instance unless you integrate a Redis adapter for Socket.io. Multiple instances do not share the `presenceRegistry` in-memory singleton or Socket.io room state.

```bash
cd /opt/sikika/backend
pm2 start ecosystem.config.js
pm2 save                    # persist across reboots
pm2 startup                 # generate and run the startup command
```

Useful PM2 commands:

```bash
pm2 status                  # list processes
pm2 logs sikika-backend     # tail logs
pm2 restart sikika-backend  # restart without downtime
pm2 stop sikika-backend     # graceful stop
```

---

## Step 5 — Nginx Configuration

Nginx handles SSL termination, serves the frontend static files, and proxies API + WebSocket traffic to the backend.

```nginx
# /etc/nginx/sites-available/sikika

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Serve compiled frontend assets
    root /opt/sikika/frontend/dist;
    index index.html;

    # Backend API — REST
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Socket.io — WebSocket upgrade required
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 86400s;     # keep long-lived WebSocket connections alive
    }

    # SPA fallback — all non-asset routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/sikika /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### WebSocket Proxying Notes

- The `Upgrade` and `Connection` headers in the `/socket.io/` block are mandatory. Without them, Socket.io falls back to HTTP long-polling, which is functional but slower and uses more server resources.
- `proxy_read_timeout 86400s` prevents Nginx from closing idle WebSocket connections after the default 60s timeout.
- Socket.io path defaults to `/socket.io/` — if changed in the application, update the Nginx location to match.

---

## Step 6 — SSL Certificate (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Certbot auto-configures the Nginx SSL blocks and sets up a cron job for renewal. Verify renewal:

```bash
certbot renew --dry-run
```

---

## Step 7 — Africa's Talking Live API

### Switching from Sandbox to Live

1. Set `AFRICASTALKING_USERNAME` to your live AT username (not `"sandbox"`).
2. Set `AFRICASTALKING_API_KEY` to your live API key.
3. Set `SKIP_SMS_IN_DEV=false` (or remove it entirely).
4. Restart the backend: `pm2 restart sikika-backend`.

The `validateEnv()` check in `index.js` enforces these rules when `NODE_ENV=production` and will refuse to start if `AFRICASTALKING_USERNAME` is `"sandbox"` or if `SKIP_SMS_IN_DEV` is `"true"`.

### USSD Callback URL

Register the USSD callback in the Africa's Talking dashboard:

```
https://yourdomain.com/api/ussd/callback
```

The endpoint accepts `POST` requests with Africa's Talking's standard payload fields (`sessionId`, `serviceCode`, `phoneNumber`, `text`).

### SMS OTP Delivery

Ensure your Africa's Talking account has a registered sender ID (or short code) for Kenya (`+254` numbers). OTPs are 4-digit numeric codes with a 10-minute TTL. The `authController.js` generates and bcrypt-hashes them before storage.

---

## Step 8 — Cloudinary Configuration

1. Create a Cloudinary account and note the Cloud Name, API Key, and API Secret.
2. Set the three Cloudinary env vars in `backend/.env`.
3. Verify that your Cloudinary account's **unsigned uploads** are disabled — all uploads go through the backend using API credentials.

### Private Asset Delivery

All three asset classes (evidence files, support resources, legal PDFs) use `type: "authenticated"`. Cloudinary account-level settings should block public signed URL generation so that direct URL access is impossible. The backend streaming proxy (`fetchPrivateAssetStream` in `cloudinary.js`) uses the API credentials to generate short-lived internal download URLs for server-side fetching, then pipes the bytes to the client.

---

## Pre-Launch Checklist

### Security

- [ ] `JWT_SECRET` is at least 64 random bytes (not a predictable string).
- [ ] `NODE_ENV=production` is set.
- [ ] `SKIP_SMS_IN_DEV=false` (OTPs not exposed in API responses).
- [ ] `AFRICASTALKING_USERNAME` is the live username (not `"sandbox"`).
- [ ] `.env` file has restricted permissions (`chmod 600 backend/.env`).
- [ ] SSL is active and `certbot renew --dry-run` passes.
- [ ] HTTP redirects to HTTPS (`listen 80 → 301`).

### Database

- [ ] MySQL is running and accepting connections from the Node process.
- [ ] `DB_SYNC_ALTER=false` (no accidental schema alter in production).
- [ ] `ENABLE_SCHEMA_COMPAT=true` (boot-time ENUM reconciliation enabled).
- [ ] Database backup scheduled (daily minimum for survivor data).

### Africa's Talking

- [ ] USSD callback URL registered: `https://yourdomain.com/api/ussd/callback`.
- [ ] Live API key and username configured.
- [ ] OTP delivery tested end-to-end with a real Kenya number.

### Cloudinary

- [ ] All three env vars set (`CLOUD_NAME`, `API_KEY`, `API_SECRET`).
- [ ] Evidence upload test: upload a file and confirm it streams back via the proxy.
- [ ] Legal document generation tested: `POST /api/legal-cases/:id/document` returns 200.

### Application

- [ ] Backend health endpoints return 200: `/api/health`, `/api/health/db`.
- [ ] Frontend SPA loads and sign-in flow works.
- [ ] Community WebSocket connects (open DevTools → Network → WS tab).
- [ ] Maintenance mode toggle works in NGO Admin dashboard.
- [ ] PM2 process is running and configured to start on system boot.

### Nginx

- [ ] `nginx -t` passes.
- [ ] `/socket.io/` location includes `Upgrade` and `Connection` headers.
- [ ] Frontend SPA fallback (`try_files ... /index.html`) works for deep-linked routes.

---

## Monitoring and Logs

```bash
# PM2 application logs
pm2 logs sikika-backend --lines 100

# Nginx access + error logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# MySQL slow query log (enable in my.cnf)
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1
```

Consider integrating PM2 with a monitoring service (PM2 Plus, Datadog, Grafana) for uptime alerts and performance dashboards.
