// Migrate plain prisma/dev.db → SQLCipher-encrypted dev.db.
// Reads source as plain SQLite, writes destination with PRAGMA key, ATTACH+sqlcipher_export.
//
// Requires: npm install better-sqlite3 better-sqlite3-multiple-ciphers
// (We try the encrypted driver first; if it's not installed, we abort with instructions.)

import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { scryptSync } from 'node:crypto';

const DB_PATH = path.resolve(process.cwd(), 'prisma', 'dev.db');
const ENC_PATH = DB_PATH + '.encrypted';
const BACKUP_PATH = DB_PATH + '.plain-backup';

function deriveKey(): string {
  const envKey = process.env.SQLCIPHER_KEY;
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) return envKey;
  if (envKey) return scryptSync(envKey, 'astroledger-sqlcipher-salt', 32).toString('hex');
  const master = process.env.MASTER_KEY;
  if (master && /^[0-9a-fA-F]{64}$/.test(master)) {
    // Derive a distinct key from MASTER_KEY so both can rotate independently.
    return scryptSync(master, 'astroledger-sqlcipher-salt', 32).toString('hex');
  }
  if (master) return scryptSync(master, 'astroledger-sqlcipher-salt', 32).toString('hex');
  throw new Error('Set SQLCIPHER_KEY or MASTER_KEY before running.');
}

async function main() {
  if (!existsSync(DB_PATH)) { console.error('No dev.db found at', DB_PATH); process.exit(1); }
  if (existsSync(BACKUP_PATH)) { console.error('Backup already exists — aborting to avoid clobber:', BACKUP_PATH); process.exit(1); }

  let SqlCipher;
  try { SqlCipher = (await import('better-sqlite3-multiple-ciphers' as any)).default; }
  catch {
    console.error('Missing dep. Run:\n  npm install better-sqlite3-multiple-ciphers\n');
    process.exit(1);
  }

  const key = deriveKey();
  console.error('Opening plain DB:', DB_PATH);
  const src = new SqlCipher(DB_PATH);
  // Verify it's actually plain (no key set)
  try { src.exec('SELECT count(*) FROM sqlite_master'); }
  catch (e: any) { console.error('Source DB unreadable as plain SQLite — already encrypted?'); process.exit(1); }

  console.error('Creating encrypted DB:', ENC_PATH);
  src.exec(`ATTACH DATABASE '${ENC_PATH.replace(/'/g, "''")}' AS encrypted KEY "x'${key}'"`);
  src.exec(`SELECT sqlcipher_export('encrypted')`);
  src.exec(`DETACH DATABASE encrypted`);
  src.close();

  // Swap files
  renameSync(DB_PATH, BACKUP_PATH);
  renameSync(ENC_PATH, DB_PATH);

  console.error('\n✓ Migration complete.');
  console.error('  - Plain backup:', BACKUP_PATH);
  console.error('  - Encrypted at:', DB_PATH);
  console.error('\nNow set ASTROLEDGER_DB_ENCRYPTED=true in .env and restart Astroledger.\n');
  console.error('To roll back: stop the app, delete dev.db, rename dev.db.plain-backup → dev.db, unset ASTROLEDGER_DB_ENCRYPTED.');
}

main().catch(e => { console.error(e); process.exit(1); });
