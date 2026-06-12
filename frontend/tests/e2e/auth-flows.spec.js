import { test, expect } from '@playwright/test';
import { buildToken, installBaseApiMocks, expectSignedInShell } from './helpers/mocks';

test.describe('Auth Flows', () => {
  test('signup OTP flow creates account and signs in', async ({ page }) => {
    await installBaseApiMocks(page);

    await page.route('**/api/auth/request-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'OTP_VERIFICATION_REQUIRED', developmentOtp: '1234' })
      });
    });

    await page.route('**/api/auth/verify-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authStage: 'AUTHENTICATED',
          token: buildToken({ role: 'SURVIVOR', userId: 'survivor-1' }),
          userId: 'survivor-1'
        })
      });
    });

    await page.goto('/join');
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await page.fill('#signupPhone', '+254711000001');
    await page.getByRole('button', { name: 'Send OTP Code' }).click();

    await page.fill('#signupOtp', '1234');
    await page.fill('#signupPassword', 'StrongPass!123');
    await page.fill('#signupNickname', 'Amina');
    await page.fill('#signupCounty', 'Nairobi');
    await page.getByRole('button', { name: 'Verify OTP & Create Password' }).click();

    await expect(page).toHaveURL(/\/home$/);
    await expectSignedInShell(page);
  });

  test('otp sign-in flow authenticates existing user', async ({ page }) => {
    await installBaseApiMocks(page);

    await page.route('**/api/auth/request-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'OTP_VERIFICATION_REQUIRED', developmentOtp: '5678' })
      });
    });

    await page.route('**/api/auth/verify-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authStage: 'AUTHENTICATED',
          token: buildToken({ role: 'SURVIVOR', userId: 'survivor-otp' }),
          userId: 'survivor-otp'
        })
      });
    });

    await page.goto('/join');
    await page.fill('#signinPhone', '+254711000002');
    await page.getByRole('button', { name: 'OTP' }).click();
    await page.getByRole('button', { name: 'Send Sign-In OTP' }).click();
    await page.fill('#signinOtp', '5678');
    await page.getByRole('button', { name: 'Verify OTP & Sign In' }).click();

    await expect(page).toHaveURL(/\/home$/);
    await expectSignedInShell(page);
  });

  test('forgot-password flow completes reset', async ({ page }) => {
    await installBaseApiMocks(page);

    await page.route('**/api/auth/forgot-password/request', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'PASSWORD_RESET_OTP_REQUIRED', developmentOtp: '9999' })
      });
    });

    await page.route('**/api/auth/forgot-password/reset', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Password reset successful.' })
      });
    });

    await page.goto('/join');
    await page.fill('#signinPhone', '+254711000003');
    await page.getByRole('button', { name: 'Forgot Password?' }).click();
    await page.fill('#resetPhone', '+254711000003');
    await page.getByRole('button', { name: 'Send Reset OTP' }).click();
    await page.fill('#resetOtp', '9999');
    await page.fill('#resetNewPassword', 'NewStrongPass!123');
    await page.getByRole('button', { name: 'Verify OTP & Reset Password' }).click();

    await expect(page.getByText('Password reset successful. You can now sign in with your new password.')).toBeVisible();
  });
});
