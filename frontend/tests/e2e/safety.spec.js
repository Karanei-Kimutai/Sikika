import { test, expect } from '@playwright/test';
import { installBaseApiMocks } from './helpers/mocks';

test('quick exit clears local session and redirects to safe URL', async ({ page }) => {
  let attemptedQuickExitRedirect = false;
  const removedKeys = [];

  await page.exposeFunction('recordRemovedStorageKey', (key) => {
    removedKeys.push(String(key));
  });

  await page.route('https://www.google.com/**', async (route) => {
    attemptedQuickExitRedirect = true;
    await route.abort();
  });

  await page.addInitScript(() => {
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      window.recordRemovedStorageKey(String(key));
      return originalRemoveItem.call(this, key);
    };

    localStorage.setItem('authToken', 'header.payload.signature');
    localStorage.setItem('userId', 'survivor-1');
  });

  await installBaseApiMocks(page);
  await page.goto('/home');

  const quickExitButton = page.getByRole('button', { name: 'Quick Exit' });
  await expect(quickExitButton).toBeVisible();

  await quickExitButton.hover();
  await quickExitButton.click();

  if (!attemptedQuickExitRedirect) {
    // The first click may expand the collapsed control without exiting.
    await quickExitButton.click();
  }

  expect(attemptedQuickExitRedirect).toBe(true);
  expect(removedKeys).toContain('authToken');
  expect(removedKeys).toContain('userId');
});
