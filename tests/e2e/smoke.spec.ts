import { test, expect } from '@playwright/test';

// End-to-end smoke against a live Astroledger (defaults to the deployed demo).
// Confirms the demo auto-signs in and every critical page renders server-side
// without erroring, showing its hallmark content. Intentionally light on
// interaction — it's a liveness/regression gate for the full deployed stack
// (Next SSR + Prisma + the demo auth flow), not a behavioral spec.

test('demo auto-signs in and lands in the app', async ({ page }) => {
  await page.goto('/');
  // The demo middleware bounces through /api/demo/start-session, mints a
  // sandbox, sets the session cookie, then lands inside the app (not /auth).
  await expect(page).not.toHaveURL(/\/auth\//, { timeout: 25_000 });
  await expect(page.locator('body')).toBeVisible();
});

const PAGES: Array<{ path: string; marker: RegExp }> = [
  { path: '/transactions', marker: /transaction/i },
  { path: '/accounts',     marker: /net worth/i },
  { path: '/envelopes',    marker: /ready to assign/i }, // the v0.4.0 zero-based banner
  { path: '/forecast',     marker: /cash position/i },   // the 90-day projection card
  { path: '/networth',     marker: /net worth/i },
  { path: '/debt',         marker: /payoff/i },           // the v0.5.0 debt planner
  { path: '/scenarios',    marker: /runway/i },           // the v0.5.4 what-if scenarios
  { path: '/schedule',     marker: /recurring/i },        // the v0.5.7 unified schedule
];

for (const p of PAGES) {
  test(`renders ${p.path}`, async ({ page }) => {
    const resp = await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    expect(resp, `${p.path} should respond`).not.toBeNull();
    expect(resp!.status(), `${p.path} HTTP status`).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(p.marker);
  });
}
