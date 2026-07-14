// Creates a fresh SQLite scratch DB for the integration suite by running
// `prisma db push` against it, and tears it down afterwards. The DB lives at
// prisma/.test-integration.db. Use an absolute URL because Prisma's schema
// engine resolves relative SQLite URLs inconsistently on Windows.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(ROOT, 'prisma', '.test-integration.db');
const URL = `file:${DB.replace(/\\/g, '/')}`;

function wipe() {
  for (const suf of ['', '-journal', '-wal', '-shm']) {
    try { rmSync(DB + suf); } catch { /* not present */ }
  }
}

export default function setup() {
  wipe();
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: URL,
      // The scratch database tests the Prisma data layer. Encryption behavior
      // has a separate unit gate and the schema engine cannot create a ciphered
      // database through Prisma's native SQLite path.
      ASTROLEDGER_DB_ENCRYPTED: 'false',
      // Prisma 6's Windows schema engine intermittently exits without a
      // diagnostic at the default Rust log filter. Keeping the engine at info
      // makes creation deterministic and preserves a useful failure trace.
      RUST_LOG: 'info',
    },
    stdio: 'pipe',
  });
  return () => wipe();
}
