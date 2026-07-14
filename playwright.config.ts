import { defineConfig, devices } from '@playwright/test';

// e2e gate. Targets a running Astroledger instance — defaults to the deployed
// public DEMO (auto-signin, demo data) so no local server orchestration is
// needed. Point at any instance with E2E_BASE_URL (e.g. http://localhost:5050
// for a local DEMO_MODE=true `next start`).
//
//   npx playwright install chromium   # one-time
//   npm run test:e2e
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://demo.astroledger.app',
    headless: true,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
