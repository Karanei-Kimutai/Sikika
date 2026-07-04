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
    localStorage.setItem('pendingMessages:chat-1', JSON.stringify([{ localId: 'm1', plaintext: 'queued', createdAt: new Date().toISOString() }]));
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
  expect(removedKeys).toContain('pendingMessages:chat-1');
});

test('sign out clears pending queued messages from localStorage', async ({ page }) => {
  const removedKeys = [];

  await page.exposeFunction('recordRemovedStorageKey', (key) => {
    removedKeys.push(String(key));
  });

  await page.addInitScript(() => {
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      window.recordRemovedStorageKey(String(key));
      return originalRemoveItem.call(this, key);
    };

    sessionStorage.setItem('authToken', 'header.payload.signature');
    sessionStorage.setItem('userId', 'survivor-1');
    localStorage.setItem('pendingMessages:chat-1', JSON.stringify([{ localId: 'm1', plaintext: 'queued', createdAt: new Date().toISOString() }]));
    localStorage.setItem('pendingMessages:chat-2', JSON.stringify([{ localId: 'm2', plaintext: 'queued-2', createdAt: new Date().toISOString() }]));
  });

  await installBaseApiMocks(page);
  await page.goto('/home');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();

  await expect(page).toHaveURL(/\/join$/);
  expect(removedKeys).toContain('pendingMessages:chat-1');
  expect(removedKeys).toContain('pendingMessages:chat-2');
});
