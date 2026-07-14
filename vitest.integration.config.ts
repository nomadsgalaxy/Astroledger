import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Integration test gate: exercises the real Prisma data layer against a
// throwaway SQLite scratch DB (prisma/.test-integration.db), created fresh by
// globalSetup via `prisma db push`. Distinct from the unit gate (vitest.config.ts,
// pure-logic only). Runs in a SINGLE fork so the shared scratch DB sees no
// cross-file parallel contention; each test isolates its own data.
//
//   npm run test:integration
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    globalSetup: ['./tests/integration/globalSetup.ts'],
    setupFiles: ['./tests/integration/setupEach.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
