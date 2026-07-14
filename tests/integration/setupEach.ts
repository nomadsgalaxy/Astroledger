// Runs in the test worker BEFORE any test module is imported — so the prisma
// singleton (src/lib/prisma.ts) binds to the scratch DB rather than dev.db.
// Also unlocks the encryption vault deterministically (dev fallback) so any
// field-extension reads don't throw, and silences the dev-key warning. Keep
// this path identical to globalSetup's absolute Windows-safe SQLite URL.
import path from 'node:path';

const db = path.resolve(process.cwd(), 'prisma', '.test-integration.db');
process.env.DATABASE_URL = `file:${db.replace(/\\/g, '/')}`;
process.env.ASTROLEDGER_DB_ENCRYPTED = 'false';
process.env.ASTROLEDGER_UNSCOPED_SYSTEM = 'true';
process.env.MASTER_KEY ??= '0'.repeat(64); // deterministic 32-byte hex for tests
