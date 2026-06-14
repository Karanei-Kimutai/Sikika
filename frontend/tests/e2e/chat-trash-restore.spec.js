/**
 * chat-trash-restore.spec.js
 * --------------------------
 * E2E tests for the chat Trash/Restore flow (Item 2 of tidy-gliding-mist.md).
 *
 * Covers:
 * 1. Survivor can delete an active channel → it disappears from the default list.
 * 2. Trash view shows the deleted channel with a "Restore Chat" action.
 * 3. Restoring the channel returns it to the active list.
 * 4. After restore, the channel is usable (can be selected and is visible).
 * 5. Staff (counsellor) cannot see the "Move to Trash" action (survivor-only UI).
 *
 * Mocking strategy: all /api/chat/* requests are intercepted so the test runs
 * entirely against the mock backend. Channel state is mutated in-memory to
 * simulate the real transition lifecycle without a running server.
 */

import { test, expect } from '@playwright/test';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

// ── Fixture data ──────────────────────────────────────────────────────────────

const CHAT_ID = 'chat-uuid-counsellor-1';

const baseChannel = {
  chatId:                    CHAT_ID,
  survivorId:                'survivor-profile-1',
  supportStaffCounterpartId: 'counsellor-user-1',
  chatChannelType:           'counsellor_channel',
  chatChannelStatus:         'active',
  unreadCount:               0,
  counterpartRole:           'COUNSELLOR',
  counterpartAvailability:   'OFFLINE',
  asyncDeliveryHint:         null
};

// ── Mock installer ────────────────────────────────────────────────────────────

/**
 * Install all chat-related API mocks. `channelState` is a single mutable object
 * so tests can check intermediate state after route handlers run.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ channelState: { status: string } }}
 */
async function installChatMocks(page) {
  // Mutable channel state — tests read this to assert transitions.
  const channelState = { status: 'active' };

  // GET /api/chat/channels — returns the channel if its status matches the query.
  await page.route('**/api/chat/channels**', async (route) => {
    const url    = new URL(route.request().url());
    const inclDel = url.searchParams.get('includeDeleted') === 'true';
    const inclArc = url.searchParams.get('includeArchived') === 'true';

    const ch = { ...baseChannel, chatChannelStatus: channelState.status };

    let visible = false;
    if (channelState.status === 'active') {
      visible = true; // always visible in default view
    } else if (channelState.status === 'archived' && inclArc) {
      visible = true;
    } else if (channelState.status === 'deleted' && inclDel) {
      visible = true;
    }

    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify(visible ? [ch] : [])
    });
  });

  // PATCH /api/chat/:chatId/status — update in-memory state.
  await page.route(`**/api/chat/${CHAT_ID}/status`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const body   = route.request().postDataJSON();
    const target = body?.status;

    // Server-side transition guard: deleted → only active allowed.
    if (channelState.status === 'deleted' && target !== 'active') {
      await route.fulfill({
        status:      400,
        contentType: 'application/json',
        body:        JSON.stringify({ error: 'Deleted channels can only be restored to active.' })
      });
      return;
    }

    channelState.status = target;

    const message =
      target === 'archived' ? 'Chat archived successfully.' :
      target === 'deleted'  ? 'Chat moved to Trash.' :
                              'Chat restored successfully.';

    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ message, channel: { chatId: CHAT_ID, chatChannelStatus: target } })
    });
  });

  // GET /api/chat/:chatId/messages — empty thread for usability check.
  await page.route(`**/api/chat/${CHAT_ID}/messages`, async (route) => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify([])
    });
  });

  // PATCH /api/chat/:chatId/mark-read — no-op.
  await page.route(`**/api/chat/${CHAT_ID}/mark-read`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { channelState };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Chat Trash / Restore flow', () => {

  test('1. Deleting an active channel moves it to Trash and hides it from default list', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-1' });
    const { channelState } = await installChatMocks(page);

    await page.goto('/chat');

    // Channel should appear in the default list.
    const chatItem = page.locator('.wa-chat-item').first();
    await expect(chatItem).toBeVisible();

    // Open the action menu (⋯ button on the chat item).
    const optionsBtn = chatItem.locator('.wa-chat-options-btn');
    await optionsBtn.click();

    // Click "Move to Trash".
    const trashBtn = page.getByRole('button', { name: /move to trash/i });
    await expect(trashBtn).toBeVisible();
    await trashBtn.click();

    // Channel state should be 'deleted'.
    expect(channelState.status).toBe('deleted');

    // Default list should now be empty.
    await expect(page.locator('.wa-empty-list')).toContainText(/no active/i);
  });

  test('2. Trash view shows the deleted channel', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-1' });
    const { channelState } = await installChatMocks(page);

    // Pre-seed as deleted.
    channelState.status = 'deleted';

    await page.goto('/chat');

    // Default view: channel not visible.
    await expect(page.locator('.wa-empty-list')).toBeVisible();

    // Click "Trash" toggle.
    await page.getByRole('button', { name: /^trash$/i }).click();

    // Channel should now appear.
    await expect(page.locator('.wa-chat-item')).toBeVisible();
    await expect(page.locator('.wa-chat-item')).toContainText(/deleted/i);
  });

  test('3. Restoring from Trash returns the channel to the active list', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-1' });
    const { channelState } = await installChatMocks(page);

    channelState.status = 'deleted';
    await page.goto('/chat');

    // Open Trash view.
    await page.getByRole('button', { name: /^trash$/i }).click();
    const chatItem = page.locator('.wa-chat-item').first();
    await expect(chatItem).toBeVisible();

    // Open action menu on the deleted channel.
    await chatItem.locator('.wa-chat-options-btn').click();

    // Only "Restore Chat" should be visible (not "Move to Trash").
    const restoreBtn = page.getByRole('button', { name: /restore chat/i });
    await expect(restoreBtn).toBeVisible();
    await expect(page.getByRole('button', { name: /move to trash/i })).not.toBeVisible();

    await restoreBtn.click();

    // Channel state should now be active.
    expect(channelState.status).toBe('active');
  });

  test('4. Restored channel is usable (visible and selectable in active list)', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-1' });
    const { channelState } = await installChatMocks(page);

    channelState.status = 'deleted';
    await page.goto('/chat');

    // Restore via Trash view.
    await page.getByRole('button', { name: /^trash$/i }).click();
    await page.locator('.wa-chat-item .wa-chat-options-btn').first().click();
    await page.getByRole('button', { name: /restore chat/i }).click();

    // Switch back to default view.
    await page.getByRole('button', { name: /hide trash/i }).click();

    // Channel is back in the active list.
    await expect(page.locator('.wa-chat-item')).toBeVisible();

    // Clicking the channel should open it (main area is visible).
    await page.locator('.wa-chat-open').first().click();
    await expect(page.locator('.wa-main')).toBeVisible();
  });

  test('5. Counsellor sees no Trash toggle or Move-to-Trash action (survivor-only UI)', async ({ page }) => {
    await installBaseApiMocks(page);
    // Log in as COUNSELLOR.
    await seedSession(page, { role: 'COUNSELLOR', userId: 'counsellor-user-1' });

    // Simple channel list mock for counsellor — one active channel on their side.
    await page.route('**/api/chat/channels**', async (route) => {
      const ch = {
        ...baseChannel,
        supportStaffCounterpartId: 'counsellor-user-1',
        chatChannelStatus: 'active'
      };
      await route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify([ch])
      });
    });

    await page.goto('/chat');

    // Trash toggle should not exist for counsellors.
    await expect(page.getByRole('button', { name: /^trash$/i })).not.toBeVisible();

    // No action menu (survivor-only feature) — the ⋯ button is not rendered.
    await expect(page.locator('.wa-chat-options-btn')).not.toBeVisible();
  });

});
