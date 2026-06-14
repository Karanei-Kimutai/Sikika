import { test, expect } from '@playwright/test';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

test.describe('Profile and Library Flows', () => {
  test('survivor can load and save profile preferences', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-profile-1' });

    await page.route('**/api/profile/me', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              userId: 'survivor-profile-1',
              phoneNumber: '+254711000111',
              role: 'SURVIVOR',
              accountStatus: 'ACTIVE'
            },
            profile: {
              displayNickname: 'Amina',
              assignedGender: 'FEMALE',
              residenceCounty: 'Nairobi',
              privacyPreferencesJson: { notificationsEnabled: true }
            },
            assignedStaff: {
              counsellor: { phoneNumber: '+254700000001' },
              legalCounsel: { phoneNumber: '+254700000002' }
            }
          })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Profile updated.' })
      });
    });

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Manage Profile' })).toBeVisible();
    await page.getByLabel('Preferred Nickname').fill('Amina Updated');
    await page.getByRole('button', { name: 'Save Profile' }).click();

    await expect(page.getByText('Profile updated successfully.')).toBeVisible();
  });

  test('staff user can edit own library resource metadata', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'COUNSELLOR', userId: 'staff-1' });

    await page.route('**/api/resources**', async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categories: [{ value: 'legal_guidance', label: 'Legal Guidance' }],
            resources: [
              {
                id: 'res-1',
                title: 'Safety Checklist',
                description: 'Initial version',
                category: 'legal_guidance',
                categoryLabel: 'Legal Guidance',
                uploaderId: 'staff-1',
                fileUrl: 'https://example.com/resource.pdf'
              }
            ]
          })
        });
        return;
      }

      if (method === 'PATCH' && url.includes('/api/resources/res-1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Resource updated.' })
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Manage resources' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.fill('#edit-title-res-1', 'Safety Checklist Updated');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Resource updated successfully.')).toBeVisible();
  });
});
