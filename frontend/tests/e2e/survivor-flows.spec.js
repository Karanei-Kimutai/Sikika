import { test, expect } from '@playwright/test';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

test.describe('Survivor Flows', () => {
  test('survivor can submit report and see it in list', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-1' });

    let reports = [];

    await page.route('**/api/reports', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ reports })
        });
        return;
      }

      if (method === 'POST') {
        reports = [
          {
            reportId: 'REP-001',
            reportStatus: 'SUBMITTED',
            category: 'domestic_violence',
            createdAt: '2026-06-11T08:00:00.000Z',
            description: 'Test report description',
            severityLevel: 'HIGH',
            location: 'Nairobi',
            date: '2026-06-10',
            evidence: []
          }
        ];

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ reportId: 'REP-001' })
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/reassignment-requests/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: [] })
      });
    });

    await page.goto('/reports');
    await page.fill('#report-category', 'domestic_violence');
    await page.fill('#report-description', 'Test report description');
    await page.fill('#report-location', 'Nairobi');
    await page.getByRole('button', { name: 'Submit Report' }).click();

    await expect(page.getByText('Report submitted successfully.')).toBeVisible();
    await expect(page.getByText('REP-001')).toBeVisible();
  });

  test('survivor can join community room and report a message', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-2' });

    await page.route('**/api/community/rooms', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rooms: [
            {
              roomId: 'room-1',
              roomName: 'General Support',
              roomCreationTimestamp: '2026-06-10T10:00:00.000Z',
              latestMessageDispatchTimestamp: '2026-06-10T12:00:00.000Z',
              joined: false,
              membersCount: 3
            }
          ]
        })
      });
    });

    await page.route('**/api/community/rooms/room-1/join', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/community/rooms/room-1/messages', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages: [
              {
                communityMessageId: 'msg-1',
                senderUserId: 'other-user',
                publicMessageContent: 'Please help me understand reporting.',
                messageDispatchTimestamp: '2026-06-10T12:10:00.000Z',
                author: { displayName: 'Community Member' }
              }
            ]
          })
        });
        return;
      }

      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/community/messages/msg-1/report', async (route) => {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/community');
    await page.getByRole('button', { name: 'Join Room' }).click();
    await expect(page.getByText('Joined room successfully.')).toBeVisible();

    await page.locator('.message-menu-trigger').first().click();
    await page.getByRole('button', { name: 'Report Message' }).click();
    await page.getByPlaceholder('Describe why this message should be reviewed.').fill('Potential harmful content.');
    await page.getByRole('button', { name: 'Submit Report' }).click();

    await expect(page.getByText('Content reported successfully.')).toBeVisible();
  });

  test('community composer blocks a duplicate post on a rapid double-click', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-4' });

    await page.route('**/api/community/rooms', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rooms: [
            {
              roomId: 'room-2',
              roomName: 'General Support',
              roomCreationTimestamp: '2026-06-10T10:00:00.000Z',
              latestMessageDispatchTimestamp: '2026-06-10T12:00:00.000Z',
              joined: true,
              membersCount: 3
            }
          ]
        })
      });
    });

    let postCount = 0;
    await page.route('**/api/community/rooms/room-2/messages', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: [] })
        });
        return;
      }

      postCount += 1;
      // Delay the response so the in-flight window is long enough to assert
      // the Send button stays disabled and a same-window second click is a no-op.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/community');
    await page.locator('.community-room-item').first().click();

    const messageInput = page.getByPlaceholder('Share support, advice, or encouragement');
    const sendButton = page.getByRole('button', { name: 'Post message' });

    await messageInput.fill('Sending support your way.');
    await sendButton.click();
    await expect(sendButton).toBeDisabled();

    // A second, rapid click while the first request is still in flight should
    // be a no-op — the browser won't deliver a click to a disabled control.
    await sendButton.click({ force: true, timeout: 1000 }).catch(() => {});

    await expect(sendButton).toBeDisabled();
    await expect(page.getByText('Message posted.')).toBeVisible({ timeout: 2000 });
    expect(postCount).toBe(1);
  });

  test('survivor direct chat loads channel list', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-3' });

    await page.route('**/api/chat/channels**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            chatId: 'chat-1',
            chatChannelType: 'counsellor_channel',
            chatChannelStatus: 'active',
            supportStaffCounterpartId: 'staff-1',
            counterpartAvailability: 'AVAILABLE',
            unreadCount: 0
          }
        ])
      });
    });

    await page.route('**/api/chat/chat-1/messages', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/chat/chat-1/read', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/chat');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(page.getByText('Assigned Counsellor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Archived' })).toBeVisible();
  });
});
