import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Multi-user e2e gate: real browser sessions for several authenticated users
// against a LOCAL non-demo server on a scratch SQLite database. globalSetup
// pushes the schema and seeds users + Session rows; specs inject each user's
// session cookie into its own browser context. Distinct from tests/e2e
// (single-visitor smoke against the deployed demo).
//
//   npm run test:e2e:multiuser
const PORT = 5077;
const DB_FILE = path.resolve(__dirname, 'prisma', '.e2e-multiuser.db');

export default defineConfig({
  testDir: './tests/e2e-multiuser',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1, // flows mutate shared state (invites, succession) — keep ordered
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Playwright launches the web server BEFORE globalSetup, so the seed must
    // run in the command chain ahead of the server.
    command: `npx tsx tests/e2e-multiuser/seed.ts && npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: `file:${DB_FILE.replace(/\\/g, '/')}`,
      ASTROLEDGER_DB_ENCRYPTED: 'false',
      DEMO_MODE: 'false',
      AUTH_SECRET: 'e2e-multiuser-secret',
      MASTER_KEY: 'e2e-multiuser-master-key',
      AUTH_URL: `http://127.0.0.1:${PORT}`,
      NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
      GOOGLE_CLIENT_ID: 'e2e-dummy',
      GOOGLE_CLIENT_SECRET: 'e2e-dummy',
    },
  },
});
