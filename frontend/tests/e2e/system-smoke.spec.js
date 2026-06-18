import { test, expect } from '@playwright/test';
import { installBaseApiMocks } from './helpers/mocks';

test('public navigation renders landing and library', async ({ page }) => {
  await installBaseApiMocks(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sikika' })).toBeVisible();

  await page.getByRole('button', { name: 'Browse Resources' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Find guides, contacts, and support documents' })).toBeVisible();
});

test('protected routes redirect anonymous users to join page', async ({ page }) => {
  await installBaseApiMocks(page);

  await page.addInitScript(() => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
  });

  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Join when you are ready' })).toBeVisible();
});

test('maintenance mode screen appears for non-system-admin users', async ({ page }) => {
  await installBaseApiMocks(page, { maintenanceEnabled: true });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'System Under Maintenance' })).toBeVisible();
  await expect(page.getByText('Scheduled test maintenance')).toBeVisible();
});
