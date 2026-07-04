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
    reportsBreakdown: { byStatus: [], byCategory: [], byCounty: [] },
    communityMetrics: { activeRooms: 0, totalMessages: 0, harmfulContentReports: 0 },
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

  // NGO Admin is the sole admin role — System Admin and its dedicated
  // infrastructure dashboard were removed. The one System Admin capability
  // that survived (maintenance mode) was folded into the NGO Admin dashboard
  // as an always-visible toggle bar above every section.
  test('ngo admin can toggle maintenance mode from the dashboard', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'NGO_ADMIN', userId: 'ngo-admin-1' });

    await page.route('**/api/admin/ngo/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ngoDashboardFixture())
      });
    });

    await page.route('**/api/admin/system/maintenance-mode', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          maintenanceMode: {
            enabled: true,
            updatedAt: '2026-06-11T08:00:00.000Z',
            reason: null,
            expectedUntil: null
          }
        })
      });
    });

    // NGO Admin's "/" resolves to the Command Center section of the
    // consolidated NGO dashboard (App.jsx ngoAdminRoutes).
    await page.goto('/');
    await expect(page.getByText('Maintenance Mode:')).toBeVisible();

    await page.getByTestId('ngo-maintenance-toggle').click();
    await expect(page.getByText('Maintenance mode enabled.')).toBeVisible();
  });

  test('lift ban from moderation queue shows loading state and disables concurrent clicks', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'NGO_ADMIN', userId: 'ngo-admin-1' });

    const dashboardPayload = {
      ...ngoDashboardFixture(),
      moderationQueue: [
        {
          reportId: 'mod-ban-1',
          submittedAt: '2026-06-11T09:00:00.000Z',
          roomName: 'General',
          snippet: 'Potentially harmful statement',
          reportReasonText: 'Threatening wording',
          status: 'PENDING',
          reporterLabel: 'Reporter U123',
          senderUserId: 'sender-1',
          senderAccountStatus: 'BANNED'
        },
        {
          reportId: 'mod-ban-2',
          submittedAt: '2026-06-11T09:05:00.000Z',
          roomName: 'General',
          snippet: 'Follow-up harmful statement',
          reportReasonText: 'Harassment',
          status: 'PENDING',
          reporterLabel: 'Reporter U124',
          senderUserId: 'sender-2',
          senderAccountStatus: 'BANNED'
        }
      ]
    };

    await page.route('**/api/admin/ngo/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardPayload)
      });
    });

    let releaseUnbanResponse;
    const unbanGate = new Promise((resolve) => {
      releaseUnbanResponse = resolve;
    });

    await page.route('**/api/admin/ngo/users/*/unban', async (route) => {
      await unbanGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Ban lifted.' })
      });
    });

    await page.goto('/moderation');

    const liftButtons = page.getByRole('button', { name: 'Lift Ban' });
    await expect(liftButtons.first()).toBeVisible();

    await liftButtons.first().click();

    await expect(page.getByRole('button', { name: 'Lifting…' }).first()).toBeDisabled();
    const visibleLiftButtons = await liftButtons.count();
    for (let i = 0; i < visibleLiftButtons; i += 1) {
      await expect(liftButtons.nth(i)).toBeDisabled();
    }

    releaseUnbanResponse();
  });
});
