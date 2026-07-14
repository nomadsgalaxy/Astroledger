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
