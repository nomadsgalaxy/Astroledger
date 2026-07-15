import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { SESSIONS } from './sessions';

// Real multi-user flows against a local non-demo server (see
// playwright.multiuser.config.ts). Each persona gets its own browser context
// with its seeded database session injected as the Auth.js cookie.

async function contextFor(browser: Browser, baseURL: string, who: keyof typeof SESSIONS): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'authjs.session-token', value: SESSIONS[who],
    url: baseURL, httpOnly: true, sameSite: 'Lax',
  }]);
  return context;
}

test.describe.configure({ mode: 'serial' });

test('owner manages the household space and sends an invitation', async ({ browser, baseURL }) => {
  const owner = await contextFor(browser, baseURL!, 'owner');
  const page = await owner.newPage();
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'Financial spaces' })).toBeVisible();
  await expect(page.getByText('owner@e2e.test').first()).toBeVisible();
  await expect(page.getByText('partner@e2e.test').first()).toBeVisible();

  await page.getByPlaceholder('Email a family member, advisor, or trusted helper').fill('newhelper@e2e.test');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText(/newhelper@e2e\.test \(viewer\)/)).toBeVisible();

  // The invitation is in the owner-visible audit trail.
  await expect(page.getByText('Invited newhelper@e2e.test as viewer')).toBeVisible();
  await owner.close();
});

test('a direct grant follows the helper into their personal space and honors expiry', async ({ browser, baseURL }) => {
  const helper = await contextFor(browser, baseURL!, 'helper');
  const page = await helper.newPage();
  await page.goto('/spaces');
  // Live grant is visible…
  await expect(page.getByText('Shared checking')).toBeVisible();
  await expect(page.getByText('SHARED TO YOU · view')).toBeVisible();
  // …the expired one is not.
  await expect(page.getByText('Shared savings')).not.toBeVisible();
  await helper.close();
});

test('export permission is enforced independently of visibility', async ({ browser, baseURL }) => {
  const helper = await contextFor(browser, baseURL!, 'helper');
  const denied = await helper.request.get('/api/export?format=csv');
  expect(denied.status()).toBe(403);
  await helper.close();

  const owner = await contextFor(browser, baseURL!, 'owner');
  const allowed = await owner.request.get('/api/export?format=csv');
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()['content-disposition']).toContain('attachment');
  expect(await allowed.text()).toContain('E2E Grocery');
  await owner.close();
});

test('document vault accepts a real document and rejects an executable', async ({ browser, baseURL }) => {
  const owner = await contextFor(browser, baseURL!, 'owner');
  const pdf = Buffer.from('%PDF-1.7\nE2E statement body\n%%EOF\n');
  const uploaded = await owner.request.post('/api/documents', {
    multipart: {
      file: { name: 'statement.pdf', mimeType: 'application/pdf', buffer: pdf },
      kind: 'statement',
    },
  });
  expect(uploaded.status()).toBe(201);

  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128)]);
  const rejected = await owner.request.post('/api/documents', {
    multipart: {
      file: { name: 'totally-a-statement.pdf', mimeType: 'application/pdf', buffer: exe },
      kind: 'statement',
    },
  });
  expect(rejected.status()).toBe(415);
  await owner.close();
});

test('a brand-new user self-heals into a working personal space on first request', async ({ browser, baseURL }) => {
  const newbie = await contextFor(browser, baseURL!, 'newbie');
  const page = await newbie.newPage();
  // First-ever authenticated request: dashboard must render with real
  // (empty-state) content, not an error or a blank shell.
  const dashboard = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(dashboard!.status()).toBeLessThan(400);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'Financial spaces' })).toBeVisible();
  await expect(page.locator('strong').filter({ hasText: "E2E Newbie's Finances" }).first()).toBeVisible();
  await expect(page.getByText('You are owner')).toBeVisible();
  // Authenticated APIs answer instead of 401/500ing on the fresh account.
  for (const path of ['/api/notifications', '/api/shared-expenses', '/api/allowances']) {
    const response = await newbie.request.get(path);
    expect(response.status(), path).toBe(200);
  }
  await newbie.close();
});

test('settings hosts the household hub with per-space management', async ({ browser, baseURL }) => {
  const owner = await contextFor(browser, baseURL!, 'owner');
  const page = await owner.newPage();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Household & spaces' })).toBeVisible();
  // The owner's household space renders as a management card with its people.
  await expect(page.locator('strong').filter({ hasText: 'E2E Family Finances' }).first()).toBeVisible();
  await expect(page.getByText('partner@e2e.test').first()).toBeVisible();
  // Cross-space management: invite into the household space FROM settings,
  // regardless of which space is active.
  await page.getByPlaceholder('Invite by email').first().fill('fromsettings@e2e.test');
  await page.getByRole('button', { name: 'Invite', exact: true }).first().click();
  await expect(page.getByText(/fromsettings@e2e\.test \(viewer\)/)).toBeVisible();
  await owner.close();

  // A non-admin member sees the hub too, with controls scaled down.
  const helper = await contextFor(browser, baseURL!, 'helper');
  const helperPage = await helper.newPage();
  await helperPage.goto('/settings');
  await expect(helperPage.getByRole('heading', { name: 'Household & spaces' })).toBeVisible();
  await expect(helperPage.getByText('Managed by your administrator')).toBeVisible();
  await helper.close();
});

test('every role can open the core pages without a server error', async ({ browser, baseURL }) => {
  const pages = ['/', '/transactions', '/accounts', '/budgets', '/spaces', '/settings', '/alerts'];
  for (const who of ['partner', 'helper', 'advisor'] as const) {
    const context = await contextFor(browser, baseURL!, who);
    const page = await context.newPage();
    for (const path of pages) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response!.status(), `${who} → ${path}`).toBeLessThan(400);
    }
    await context.close();
  }
});

test('a nominated successor executes an approved request after the waiting period', async ({ browser, baseURL }) => {
  const advisor = await contextFor(browser, baseURL!, 'advisor');
  const page = await advisor.newPage();
  await page.goto('/spaces');
  // The successor sees the continuity panel but no financial data.
  await expect(page.getByText('Succession request: approved')).toBeVisible();
  await expect(page.getByText('Shared checking')).not.toBeVisible();

  await page.getByRole('button', { name: 'Execute after wait' }).click();
  await expect(page.getByText('You are owner')).toBeVisible();
  // Ownership arrived: the space's accounts are now visible to the new owner.
  await expect(page.getByText('Shared checking').first()).toBeVisible();
  await advisor.close();

  // The previous owner has been demoted to continuity-only successor.
  const owner = await contextFor(browser, baseURL!, 'owner');
  const ownerPage = await owner.newPage();
  await ownerPage.goto('/spaces');
  await expect(ownerPage.getByText('You are successor')).toBeVisible();
  await owner.close();
});
