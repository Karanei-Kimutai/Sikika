/**
 * notification-deep-link.spec.js
 * -------------------------------
 * Regression coverage for a bug found in PR43 review: clicking a notification
 * deep-link (e.g. /chat?channel=..., /community?room=..., /reports?reportId=...)
 * only worked when navigating in from a *different* page. If the user was
 * already on the target pathname, App.jsx's router never re-rendered (it only
 * tracked pathname, not the query string), so the page's mount-time deep-link
 * read never re-ran.
 *
 * Fixed by keying the routed <Page> on the full pathname+search ("locationVersion"
 * in App.jsx) so a query-only navigation forces a real remount. These tests
 * simulate that exact scenario — already on the target page, then a query-only
 * navigation (as a notification click or browser back/forward would produce) —
 * across the three deep-link targets named in the review: chat, community, reports.
 */

import { test, expect } from '@playwright/test';
import { webcrypto } from 'node:crypto';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

/** Simulates a same-pathname, query-only navigation (what a notification click,
 * or browser back/forward, produces) without leaving the current page. */
async function navigateQueryOnly(page, path) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function generatePeerPublicKeyJwk() {
  const { publicKey } = await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const jwk = await webcrypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(jwk);
}

test.describe('Notification deep-link navigation while already on the target page', () => {
  test('chat: query-only navigation switches the active channel', async ({ page }) => {
    const CHANNEL_A = 'chat-aaaaaaaa-0000-0000-0000-000000000000';
    const CHANNEL_B = 'chat-bbbbbbbb-0000-0000-0000-000000000000';

    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-1' });

    const peerPublicKeyJwk = await generatePeerPublicKeyJwk();
    await page.route('**/api/chat/public-key/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ecdhPublicKey: peerPublicKeyJwk }) });
    });

    await page.route('**/api/chat/channels**', async (route) => {
      const channels = [
        {
          chatId: CHANNEL_A,
          survivorId: 'survivor-profile-1',
          supportStaffCounterpartId: 'counsellor-user-1',
          counterpartUserId: 'counsellor-user-1',
          chatChannelType: 'counsellor_channel',
          chatChannelStatus: 'active',
          unreadCount: 0,
          counterpartRole: 'COUNSELLOR',
          counterpartAvailability: 'OFFLINE',
          asyncDeliveryHint: null
        },
        {
          chatId: CHANNEL_B,
          survivorId: 'survivor-profile-1',
          supportStaffCounterpartId: 'legal-user-1',
          counterpartUserId: 'legal-user-1',
          chatChannelType: 'legal_channel',
          chatChannelStatus: 'active',
          unreadCount: 0,
          counterpartRole: 'LEGAL_COUNSEL',
          counterpartAvailability: 'OFFLINE',
          asyncDeliveryHint: null
        }
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channels) });
    });
    await page.route('**/api/chat/*/messages', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/api/chat/*/mark-read', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Land on /chat with no query — fallback selection picks channel A.
    await page.goto('/chat');
    await expect(page.locator('.wa-chat-item').first()).toBeVisible();
    await expect(page.locator('.wa-chat-item.active')).toContainText(CHANNEL_A.slice(0, 8));

    // Already on /chat — a notification click for a *different* channel only
    // changes the query string.
    await navigateQueryOnly(page, `/chat?channel=${CHANNEL_B}`);

    await expect(page.locator('.wa-chat-item.active')).toContainText(CHANNEL_B.slice(0, 8));
  });

  test('community: query-only navigation switches the active room', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-2' });

    await page.route('**/api/community/rooms', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rooms: [
            {
              roomId: 'room-a',
              roomName: 'General Support',
              roomCreationTimestamp: '2026-06-10T10:00:00.000Z',
              latestMessageDispatchTimestamp: '2026-06-10T12:00:00.000Z',
              joined: true,
              membersCount: 3
            },
            {
              roomId: 'room-b',
              roomName: 'Legal Q&A',
              roomCreationTimestamp: '2026-06-09T10:00:00.000Z',
              latestMessageDispatchTimestamp: '2026-06-09T12:00:00.000Z',
              joined: true,
              membersCount: 5
            }
          ]
        })
      });
    });
    await page.route('**/api/community/rooms/*/messages', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) });
    });

    // Land on /community with no query — fallback selection picks room A (list order).
    await page.goto('/community');
    await expect(page.locator('.community-room-item').first()).toBeVisible();
    await expect(page.locator('.community-room-item.active')).toContainText('General Support');

    // Already on /community — notification click for a different room.
    await navigateQueryOnly(page, '/community?room=room-b');

    await expect(page.locator('.community-room-item.active')).toContainText('Legal Q&A');
  });

  test('reports: query-only navigation highlights the deep-linked report', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-user-3' });

    await page.route('**/api/reports', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reports: [
            {
              reportId: 'REP-001',
              reportStatus: 'SUBMITTED',
              category: 'domestic_violence',
              createdAt: '2026-06-11T08:00:00.000Z',
              description: 'First report',
              severityLevel: 'HIGH',
              location: 'Nairobi',
              date: '2026-06-10',
              evidence: []
            },
            {
              reportId: 'REP-002',
              reportStatus: 'UNDER_REVIEW',
              category: 'harassment',
              createdAt: '2026-06-12T08:00:00.000Z',
              description: 'Second report',
              severityLevel: 'MEDIUM',
              location: 'Mombasa',
              date: '2026-06-11',
              evidence: []
            }
          ]
        })
      });
    });
    await page.route('**/api/reassignment-requests/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) });
    });

    // Land on /reports with no query — nothing highlighted.
    await page.goto('/reports');
    await expect(page.locator('#report-REP-001')).toBeVisible();
    await expect(page.locator('#report-REP-001')).not.toHaveClass(/resource-tile--highlighted/);

    // Already on /reports — notification click deep-links to the second report.
    await navigateQueryOnly(page, '/reports?reportId=REP-002');

    await expect(page.locator('#report-REP-002')).toHaveClass(/resource-tile--highlighted/);
  });
});
