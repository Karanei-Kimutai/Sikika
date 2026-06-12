import { test, expect } from '@playwright/test';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

function ngoDashboardFixture() {
  return {
    profile: { userId: 'ngo-admin-1', department: 'Ops', accessLevel: 2 },
    overview: {
      totalReports: 2,
      reportTrendPercent: 5,
      activeSurvivors: 1,
      averageResponseMinutes: 12,
      averageResponseSampleCount: 3,
      activeLegalCases: 1
    },
    reportsOverTime: [],
    reportBreakdown: { byStatus: [], byCategory: [], bySeverity: [], byCounty: [] },
    recentUrgentCases: [],
    recentReports: [],
    recentCommunityMessages: [],
    communityRooms: [],
    staffWorkload: { counsellors: [], legalCounsel: [] },
    staffDirectory: [],
    survivorAssignments: [],
    reassignmentRequests: [],
    moderationQueue: [
      {
        reportId: 'mod-1',
        submittedAt: '2026-06-11T09:00:00.000Z',
        roomName: 'General',
        snippet: 'Potentially harmful statement',
        reportReasonText: 'Threatening wording',
        status: 'PENDING',
        reporterLabel: 'Reporter U123'
      }
    ],
    resources: [],
    resourceAnalytics: { topAccessedResources: [], usageByCategory: [] }
  };
}

function systemDashboardFixture() {
  return {
    profile: { userId: 'sys-admin-1', systemAccessLevel: 1 },
    statusBadge: 'ALL_SYSTEMS_OPERATIONAL',
    metrics: {
      serverUptimeSeconds: 3600,
      databaseConnectionStatus: 'CONNECTED',
      databaseLatencyMs: 21,
      otpGatewayStatus: 'AVAILABLE'
    },
    maintenanceMode: {
      enabled: false,
      updatedAt: '2026-06-11T08:00:00.000Z',
      reason: 'Routine checks',
      expectedUntil: '2026-06-11T10:30:00.000Z'
    },
    runtimeActions: {
      lastCacheClearAt: '2026-06-11T07:30:00.000Z',
      lastRestartRequestAt: '2026-06-11T07:00:00.000Z'
    },
    errorLogs: [],
    systemAdmins: []
  };
}

test.describe('Admin Flows', () => {
  test('ngo admin moderation flow opens details and triggers action', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'NGO_ADMIN', userId: 'ngo-admin-1' });

    await page.route('**/api/admin/ngo/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ngoDashboardFixture())
      });
    });

    await page.route('**/api/community/moderation/reports/mod-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Moderation action saved.' })
      });
    });

    await page.goto('/moderation');
    await expect(page.getByRole('heading', { name: 'Community Moderation Queue' })).toBeVisible();

    await page.getByRole('button', { name: 'View Message + Reason' }).click();
    await expect(page.getByRole('heading', { name: 'Moderation Report Details' })).toBeVisible();
    await expect(page.getByText('Threatening wording')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.locator('tr', { hasText: 'General' }).getByRole('button', { name: 'Issue Warning' }).click();
    await expect(page.getByText('Moderation action completed.')).toBeVisible();
  });

  test('system admin can invoke maintenance controls', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SYSTEM_ADMIN', userId: 'sys-admin-1' });

    await page.route('**/api/admin/system/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemDashboardFixture())
      });
    });

    await page.route('**/api/admin/system/maintenance-mode', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Maintenance mode updated successfully.' })
      });
    });

    await page.route('**/api/admin/system/runtime-action', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Runtime action completed.' })
      });
    });

    await page.goto('/chat');
    await expect(page.getByRole('heading', { name: 'Maintenance and Runtime Control' })).toBeVisible();

    await page.getByRole('button', { name: 'Enable Maintenance Mode' }).click();
    await expect(page.getByText('Maintenance mode updated successfully.')).toBeVisible();

    await page.getByRole('button', { name: 'Clear System Cache' }).click();
    await expect(page.getByText('Runtime action completed.')).toBeVisible();
  });
});
