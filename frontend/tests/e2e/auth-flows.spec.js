import { test, expect } from '@playwright/test';
import { buildToken, installBaseApiMocks, expectSignedInShell, seedSession } from './helpers/mocks';

test.describe('Auth Flows', () => {
  test('signup flow (OTP verification then password/profile details) creates account and signs in', async ({ page }) => {
    await installBaseApiMocks(page);

    await page.route('**/api/auth/request-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'OTP_VERIFICATION_REQUIRED', developmentOtp: '1234' })
      });
    });

    // Step 2: verify-otp now only confirms the code and issues a short-lived
    // signup ticket — it does NOT authenticate the user yet.
    await page.route('**/api/auth/verify-otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'DETAILS_REQUIRED', signupTicket: 'ticket-abc123' })
      });
    });

    // Step 3: complete-signup carries the ticket + password + profile details
    // and is what actually issues the JWT.
    await page.route('**/api/auth/complete-signup', async (route) => {
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
    await page.getByRole('tab', { name: 'Sign Up', exact: true }).click();

    // Step 1: phone -> send OTP
    await page.fill('#signupPhone', '+254711000001');
    await page.getByTestId('signup-send-otp').click();

    // Step 2: OTP only (no password field on this step anymore)
    await page.fill('#signupOtp', '1234');
    await page.getByTestId('signup-verify-code').click();

    // Step 3: password + profile details
    await page.fill('#signupPassword', 'StrongPass!123');
    await page.fill('#signupNickname', 'Amina');
    await page.fill('#signupCounty', 'Nairobi');
    await page.getByTestId('signup-create-account').click();

    await expect(page).toHaveURL(/\/home$/);
    await expectSignedInShell(page);
  });

  test('password sign-in flow with mandatory OTP 2FA authenticates existing user', async ({ page }) => {
    await installBaseApiMocks(page);

    // login-password validates the password but does NOT issue a JWT — it
    // always advances to the mandatory OTP 2FA step.
    await page.route('**/api/auth/login-password', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authStage: 'OTP_2FA_REQUIRED', developmentOtp: '5678' })
      });
    });

    // verify-2fa is the endpoint that actually issues the JWT.
    await page.route('**/api/auth/verify-2fa', async (route) => {
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
    // Sign In is the default tab — no separate "OTP" tab exists; OTP is
    // enforced as 2FA after a successful password match.
    await page.fill('#signinPhone', '+254711000002');
    await page.fill('#signinPassword', 'StrongPass!123');
    await page.getByTestId('signin-submit').click();

    await page.fill('#signinTwoFactorOtp', '5678');
    await page.getByTestId('signin-2fa-submit').click();

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
    // request flow may auto-advance to verify when developmentOtp is returned.
    const sendResetOtpButton = page.getByRole('button', { name: 'Send Reset OTP' });
    if (await sendResetOtpButton.isVisible()) {
      await sendResetOtpButton.click();
    }
    await page.fill('#resetOtp', '9999');
    await page.fill('#resetNewPassword', 'NewStrongPass!123');
    await page.getByRole('button', { name: 'Verify OTP & Reset Password' }).click();

    await expect(page.getByText('Password reset successful. You can now sign in with your new password.')).toBeVisible();
  });

  test('global 401 handling clears session and redirects to join', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'SURVIVOR', userId: 'survivor-401' });

    // ManageProfilePage now uses apiClient; a 401 here should trigger the
    // shared response interceptor redirect instead of just showing a local error.
    await page.route('**/api/profile/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' })
      });
    });

    await page.goto('/profile');
    await expect(page).toHaveURL(/\/join$/);
  });
});
