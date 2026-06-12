import { expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

export function buildToken({ role = 'SURVIVOR', userId = 'user-1' } = {}) {
  const payload = Buffer.from(JSON.stringify({ role, userId, id: userId })).toString('base64url');
  return `header.${payload}.signature`;
}

export async function seedSession(page, { role = 'SURVIVOR', userId = 'user-1' } = {}) {
  const token = buildToken({ role, userId });
  await page.addInitScript(({ savedToken, savedUserId }) => {
    localStorage.setItem('authToken', savedToken);
    localStorage.setItem('userId', savedUserId);
  }, { savedToken: token, savedUserId: userId });
  return token;
}

export async function installBaseApiMocks(page, { maintenanceEnabled = false } = {}) {
  // Fallback for unmatched API calls so frontend can continue rendering.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({})
    });
  });

  await page.route('**/api/system/public-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        maintenanceMode: {
          enabled: maintenanceEnabled,
          updatedAt: '2026-06-11T08:00:00.000Z',
          reason: maintenanceEnabled ? 'Scheduled test maintenance' : null,
          expectedUntil: maintenanceEnabled ? '2026-06-11T10:30:00.000Z' : null
        }
      })
    });
  });

  await page.route('**/api/resources**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resources: [] })
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ tracked: true })
    });
  });
}

export async function expectSignedInShell(page) {
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
}
