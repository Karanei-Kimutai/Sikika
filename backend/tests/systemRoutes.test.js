const request = require('supertest');
const express = require('express');

const { maintenanceGuard, getMaintenanceModeState } = require('../src/controllers/adminController');

const authRoutes = require('../src/routes/authRoutes');
const resourceRoutes = require('../src/routes/resourceRoutes');
const chatRoutes = require('../src/routes/chatRoutes');
const reportRoutes = require('../src/routes/reportRoutes');
const communityRoutes = require('../src/routes/communityRoutes');
const adminRoutes = require('../src/routes/adminRoutes');
const profileRoutes = require('../src/routes/profileRoutes');
const reassignmentRequestRoutes = require('../src/routes/reassignmentRequestRoutes');
const authMiddleware = require('../src/middleware/authMiddleware');

function buildSystemTestApp() {
  const app = express();
  app.use(express.json());
  app.use(maintenanceGuard);

  app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from Express backend!' });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/system/public-status', (req, res) => {
    res.json({ maintenanceMode: getMaintenanceModeState() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/reassignment-requests', reassignmentRequestRoutes);

  app.get('/api/auth/session', authMiddleware, (req, res) => {
    res.json({ authenticated: true, user: req.user });
  });

  return app;
}

describe('System Route Smoke Tests', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  beforeEach(() => {
    app = buildSystemTestApp();
  });

  test('serves public health/status endpoints', async () => {
    const hello = await request(app).get('/api/hello');
    const health = await request(app).get('/api/health');
    const status = await request(app).get('/api/system/public-status');

    expect(hello.status).toBe(200);
    expect(hello.body).toHaveProperty('message');

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });

    expect(status.status).toBe(200);
    expect(status.body).toHaveProperty('maintenanceMode');
    expect(status.body.maintenanceMode).toHaveProperty('enabled');
  });

  test('rejects protected routes without auth header', async () => {
    const checks = [
      ['get', '/api/chat/channels'],
      ['get', '/api/chat/test-chat/messages'],
      ['patch', '/api/chat/test-chat/read'],
      ['patch', '/api/chat/test-chat/status'],
      ['get', '/api/community/rooms'],
      ['get', '/api/admin/ngo/dashboard'],
      ['get', '/api/profile/me'],
      ['get', '/api/reassignment-requests/me'],
      ['post', '/api/resources'],
      ['post', '/api/auth/set-password']
    ];

    for (const [method, path] of checks) {
      const response = await request(app)[method](path);
      expect(response.status).toBe(401);
    }
  });

  test('returns report-specific unauthorized payload on reports endpoints', async () => {
    const response = await request(app).get('/api/reports');

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('registered and authenticated survivors');
    expect(response.body.redirectTo).toBe('/emergency-contacts');
    expect(Array.isArray(response.body.emergencyContacts)).toBe(true);
  });

  test('rejects invalid bearer tokens', async () => {
    const response = await request(app)
      .get('/api/chat/channels')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid or expired token.');
  });
});
