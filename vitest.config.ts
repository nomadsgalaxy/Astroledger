import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config for Astroledger's UNIT test gate: pure-logic regression tests
// for lib/* modules. Prisma INTEGRATION tests live under tests/integration/ and
// run via vitest.integration.config.ts (scratch-DB harness) — excluded here so
// `npm test` stays fast and DB-free.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/e2e/**'],
    environment: 'node',
    globals: false,
    pool: 'forks', // each test file gets a clean module graph
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
