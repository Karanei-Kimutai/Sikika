/**
 * reduced-motion.spec.js
 * ----------------------
 * Locks in the platform-wide reduced-motion policy documented in
 * frontend/src/utils/motion.js: every animation helper is wrapped in
 * `gsap.matchMedia()` against `(prefers-reduced-motion: no-preference)`, so a
 * visitor with OS-level reduced motion enabled gets the final visual state
 * immediately — never a "lighter" version of the animation. Motion is a
 * headline feature of this UI, so this is real, load-bearing behavior, not
 * decoration.
 *
 * Each test calls `page.emulateMedia({ reducedMotion: 'reduce' })` directly
 * (rather than the `test.use({ reducedMotion })` context option) — in this
 * environment the context-option form reliably emulates the media feature
 * for a blank page but not for this Vite-served app specifically, while the
 * explicit `page.emulateMedia()` call applies correctly either before or
 * after navigation. Same underlying signal `gsap.matchMedia()` reads in the
 * browser; this is just the reliable way to set it here.
 */

import { test, expect } from '@playwright/test';
import { installBaseApiMocks, seedSession } from './helpers/mocks';

function ngoDashboardFixture(totalReports) {
  return {
    profile: { userId: 'ngo-admin-1', department: 'Ops', accessLevel: 2 },
    overview: {
      totalReports,
      reportTrendPercent: 12,
      activeSurvivors: 9,
      averageResponseMinutes: 21,
      averageResponseSampleCount: 4,
      activeLegalCases: 2
    },
    reportsOverTime: [],
    reportsBreakdown: { byStatus: [], byCategory: [], byCounty: [] },
    communityMetrics: { activeRooms: 0, totalMessages: 0, harmfulContentReports: 0 },
    recentUrgentCases: [],
    recentReports: [],
    recentCommunityMessages: [],
    communityRooms: [],
    staffWorkload: { counsellors: [], legalCounsel: [] },
    staffDirectory: [],
    survivorAssignments: [],
    reassignmentRequests: [],
    moderationQueue: [],
    resources: [],
    resourceAnalytics: { topAccessedResources: [], usageByCategory: [] }
  };
}

test.describe('Reduced motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Command Center KPI counters show their final value immediately, with no count-up ramp', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'NGO_ADMIN', userId: 'ngo-admin-1' });

    await page.route('**/api/admin/ngo/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ngoDashboardFixture(257))
      });
    });

    // NGO Admin's "/" resolves to the Command Center section.
    await page.goto('/');

    const metric = page.locator('.admin-stat-card').first().locator('.admin-metric span').first();
    await metric.waitFor({ state: 'attached' });

    // Give React/GSAP a brief moment to run their mount effects, then take a
    // single, non-retrying read. countUp()'s reduced-motion fallback
    // (`gsap.set` in motion.js) applies the final value synchronously in that
    // effect — under normal motion the same span would still be mid-ramp
    // (GSAP tweens it from 0 over ~0.7s), so a single immediate read is a
    // real assertion, not just an eventually-true one.
    await page.waitForTimeout(120);
    const text = await metric.textContent();
    expect(text).toBe('257');
  });

  test('Command Center KPI cards are immediately visible, with no stagger entrance delay', async ({ page }) => {
    await installBaseApiMocks(page);
    await seedSession(page, { role: 'NGO_ADMIN', userId: 'ngo-admin-1' });

    await page.route('**/api/admin/ngo/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ngoDashboardFixture(4))
      });
    });

    await page.goto('/');

    const lastCard = page.locator('.admin-stat-card').nth(3);
    await lastCard.waitFor({ state: 'attached' });

    // staggerIn()'s reduced-motion fallback sets opacity:1/transform:none
    // synchronously — under normal motion the 4th (staggered) card would
    // still be at opacity 0 moments after mount.
    await page.waitForTimeout(120);
    const opacity = await lastCard.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });

  test('Landing page entrance has no fade/slide-in delay', async ({ page }) => {
    await installBaseApiMocks(page);
    await page.goto('/');

    // App.jsx's PageTransition wraps every routed page in a plain <div ref>
    // and runs fadeInUp() on THAT div, not on the <main> it contains —
    // opacity doesn't inherit, so the assertion must target the wrapper
    // itself, not a descendant of it.
    const pageWrapper = page.locator('main').first().locator('xpath=..');
    await pageWrapper.waitFor({ state: 'attached' });

    // Under reduced motion, fadeInUp()'s fallback (`gsap.set` in motion.js)
    // applies the final opacity/transform synchronously in the mount effect.
    // Under normal motion the same wrapper would still be mid-tween here
    // (duration 0.4s, well past this 120ms check).
    await page.waitForTimeout(120);
    const opacity = await pageWrapper.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });
});
