#!/usr/bin/env node

// Fail-closed database administration for Astroledger's encrypted SQLite
// deployment. This file is deliberately standalone so it can run in the slim
// production image before Next.js starts.

import Database from 'better-sqlite3-multiple-ciphers';
import {
  createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync,
} from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const BACKUP_MAGIC = Buffer.from('ALDGRENC', 'ascii');
const BACKUP_HEADER_LEN = 52;
const FILE_MAGIC = Buffer.from('ALFILE01', 'ascii');

function secret(fileEnv, valueEnv, required = true) {
  const file = process.env[fileEnv]?.trim();
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[valueEnv]?.trim();
  if (!value && required) throw new Error(`${fileEnv} (preferred) or ${valueEnv} is required`);
  return value || null;
}

function keyFromSource(source, salt) {
  return /^[0-9a-fA-F]{64}$/.test(source)
    ? Buffer.from(source, 'hex')
    : scryptSync(source, salt, 32);
}

function dbKey() {
  return keyFromSource(secret('ASTROLEDGER_DB_KEY_FILE', 'SQLCIPHER_KEY'), 'astroledger-db-key-v1');
}

function masterKey(old = false) {
  const source = old
    ? secret('ASTROLEDGER_OLD_MASTER_KEY_FILE', 'ASTROLEDGER_OLD_MASTER_KEY', false)
    : secret('ASTROLEDGER_MASTER_KEY_FILE', 'MASTER_KEY');
  return source ? keyFromSource(source, 'astroledger-app-salt') : null;
}

function dbPath() {
  const url = process.env.DATABASE_URL || 'file:/data/astroledger.db';
  if (!url.startsWith('file:')) throw new Error('Only file: SQLite DATABASE_URL values are supported');
  return resolve(url.slice(5));
}

function isPlainSqlite(file) {
  if (!existsSync(file) || statSync(file).size < SQLITE_MAGIC.length) return false;
  return readFileSync(file).subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
}

function openDatabase(file, encrypted) {
  const db = new Database(file);
  let key = null;
  try {
    if (encrypted) {
      key = dbKey();
      db.key(key);
    }
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    db.pragma('busy_timeout = 8000');
    return db;
  } catch (error) {
    db.close();
    throw error;
  } finally {
    key?.fill(0);
  }
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function encryptBackup(gzipBlob, password) {
  if (password.length < 12) throw new Error('Backup key must contain at least 12 characters');
  const N = 131072, r = 8, p = 1;
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.alloc(BACKUP_HEADER_LEN);
  BACKUP_MAGIC.copy(header, 0);
  header.writeUInt8(1, 8); header.writeUInt8(1, 9); header.writeUInt8(1, 10);
  header.writeUInt32BE(N, 12); header.writeUInt32BE(r, 16); header.writeUInt32BE(p, 20);
  salt.copy(header, 24); iv.copy(header, 40);
  const key = scryptSync(Buffer.from(password.normalize('NFC')), salt, 32, { N, r, p, maxmem: 256 * N * r });
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(header);
    const ct = Buffer.concat([cipher.update(gzipBlob), cipher.final()]);
    return Buffer.concat([header, ct, cipher.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}

function encryptedSnapshot(db, label) {
  const password = secret('ASTROLEDGER_BACKUP_KEY_FILE', 'ASTROLEDGER_BACKUP_KEY');
  const live = dbPath();
  const scratch = resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR || dirname(live));
  const outDir = resolve(process.env.ASTROLEDGER_PRE_MIGRATE_DIR || join(dirname(live), 'pre-migrate'));
  mkdirSync(scratch, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const nonce = randomBytes(8).toString('hex');
  const plain = join(scratch, `.astroledger-snapshot-${nonce}.db`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(outDir, `${basename(live)}.${stamp}.${label}.db.enc`);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec(`VACUUM INTO ${sqlQuote(plain)}`);
    // VACUUM INTO inherits the source cipher, so decrypt the scratch copy.
    // The snapshot's protection is the backup-key envelope; a restore must
    // not additionally depend on whichever database key was current when the
    // snapshot was taken (that key may have been rotated away).
    if (!isPlainSqlite(plain)) {
      const copy = openDatabase(plain, true);
      try {
        copy.pragma('journal_mode = DELETE');
        copy.rekey(Buffer.alloc(0)); // empty key = decrypt
      } finally { copy.close(); }
      if (!isPlainSqlite(plain)) throw new Error('Snapshot decrypt failed: scratch copy still has an encrypted header');
    }
    writeFileSync(out, encryptBackup(gzipSync(readFileSync(plain)), password), { mode: 0o600 });
    chmodSync(out, 0o600);
    const snapshots = readdirSync(outDir)
      .filter(name => name.endsWith('.db.enc'))
      .map(name => ({ name, mtime: statSync(join(outDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of snapshots.slice(5)) rmSync(join(outDir, old.name), { force: true });
    console.log(`[db-admin] encrypted snapshot created: ${out}`);
    return out;
  } finally {
    rmSync(plain, { force: true });
  }
}

function verify() {
  const file = dbPath();
  if (isPlainSqlite(file)) throw new Error('Database still has a plaintext SQLite header');
  const db = openDatabase(file, true);
  try {
    const result = db.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check failed: ${result}`);
    const tables = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    console.log(`[db-admin] encrypted database verified (${tables} tables)`);
  } finally {
    db.close();
  }
}

function migrate() {
  const live = dbPath();
  mkdirSync(dirname(live), { recursive: true });
  if (!existsSync(live)) {
    const db = new Database(live);
    const key = dbKey();
    try {
      db.key(key);
      db.exec('PRAGMA user_version = 0');
    } finally {
      key.fill(0);
      db.close();
    }
    verify();
    console.log('[db-admin] initialized a new encrypted database');
    return;
  }
  if (!isPlainSqlite(live)) {
    verify();
    console.log('[db-admin] migration skipped: database is already encrypted');
    return;
  }

  const source = openDatabase(live, false);
  try {
    const integrity = source.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Source integrity_check failed: ${integrity}`);
    encryptedSnapshot(source, 'before-encryption');
    source.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    source.close();
  }

  const scratch = resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR || dirname(live));
  mkdirSync(scratch, { recursive: true });
  const plainTmp = join(scratch, `.astroledger-encrypt-${randomBytes(8).toString('hex')}.db`);
  const cipherTmp = live + '.encrypting';
  const retired = live + '.plaintext-retired';
  rmSync(plainTmp, { force: true });
  rmSync(cipherTmp, { force: true });
  rmSync(retired, { force: true });
  try {
    copyFileSync(live, plainTmp);
    const db = openDatabase(plainTmp, false);
    const key = dbKey();
    try {
      // Multiple-ciphers cannot re-key a database while its persistent journal
      // mode is WAL. The source was checkpointed above; switch only the tmpfs
      // copy to DELETE before re-keying, then the schema step re-enables WAL.
      db.pragma('journal_mode = DELETE');
      db.rekey(key);
    } finally { key.fill(0); db.close(); }
    if (isPlainSqlite(plainTmp)) throw new Error('Re-key operation left a plaintext header');
    copyFileSync(plainTmp, cipherTmp);
    renameSync(live, retired);
    renameSync(cipherTmp, live);
    try {
      verify();
    } catch (error) {
      rmSync(live, { force: true });
      renameSync(retired, live);
      throw error;
    }
    rmSync(retired, { force: true });
    rmSync(live + '-wal', { force: true });
    rmSync(live + '-shm', { force: true });
    console.log('[db-admin] plaintext database migrated and retired copy removed');
  } finally {
    rmSync(plainTmp, { force: true });
    rmSync(cipherTmp, { force: true });
  }
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  )`);
}

function baselineAll() {
  const root = resolve(process.cwd(), 'prisma', 'migrations');
  const db = openDatabase(dbPath(), true);
  try {
    ensureMigrationTable(db);
    const applied = new Set(db.prepare(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    ).all().map(row => row.migration_name));
    const insert = db.prepare(`INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
      VALUES (?, ?, ?, ?, ?, 1)`);
    db.transaction(() => {
      for (const name of readdirSync(root).filter(name => existsSync(join(root, name, 'migration.sql'))).sort()) {
        if (applied.has(name)) continue;
        const sql = readFileSync(join(root, name, 'migration.sql'), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const now = new Date().toISOString();
        insert.run(randomBytes(16).toString('hex'), checksum, now, name, now);
        console.log(`[db-admin] baselined migration ${name}`);
      }
    })();
  } finally {
    db.close();
  }
}

function snapshot() {
  const file = dbPath();
  if (!existsSync(file)) throw new Error(`Database does not exist: ${file}`);
  const db = openDatabase(file, !isPlainSqlite(file));
  try { encryptedSnapshot(db, 'before-schema-reconcile'); } finally { db.close(); }
}

function migrateSchema() {
  const root = resolve(process.cwd(), 'prisma', 'migrations');
  if (!existsSync(root)) throw new Error(`Migration directory missing: ${root}`);
  const db = openDatabase(dbPath(), true);
  try {
    ensureMigrationTable(db);
    const applied = new Set(db.prepare(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    ).all().map(row => row.migration_name));
    const names = readdirSync(root).filter(name => existsSync(join(root, name, 'migration.sql'))).sort();
    const pending = names.filter(name => !applied.has(name));
    if (!pending.length) {
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 8000');
      console.log('[db-admin] schema is current');
      return;
    }
    encryptedSnapshot(db, 'before-schema');
    for (const name of pending) {
      const sql = readFileSync(join(root, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const coreExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Institution'").get();
      const baseline = name === '0_init' && coreExists;
      db.transaction(() => {
        if (!baseline) db.exec(sql);
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
          VALUES (?, ?, ?, ?, ?, 1)`).run(randomBytes(16).toString('hex'), checksum, now, name, now);
      })();
      console.log(`[db-admin] ${baseline ? 'baselined' : 'applied'} migration ${name}`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 8000');
  } finally {
    db.close();
  }
}

function decryptField(value, key) {
  if (!value.startsWith('v1:')) return value;
  const data = Buffer.from(value.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

function encryptField(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

function migrateFields() {
  const current = masterKey();
  const oldSource = secret('ASTROLEDGER_OLD_MASTER_KEY_FILE', 'ASTROLEDGER_OLD_MASTER_KEY', false);
  const rotating = !!oldSource;
  const old = oldSource ? keyFromSource(oldSource, 'astroledger-app-salt') : current;
  const db = openDatabase(dbPath(), true);
  const definitions = [
    ['Institution', 'id', ['accessToken']],
    ['Order', 'id', ['raw']],
    ['Account', 'id', ['refresh_token', 'access_token', 'id_token']],
  ];
  let changed = 0;
  try {
    const jobs = [];
    for (const [table, idColumn, fields] of definitions) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      for (const field of fields) {
        const rows = db.prepare(`SELECT "${idColumn}" AS id, "${field}" AS value FROM "${table}" WHERE "${field}" IS NOT NULL AND "${field}" <> ''`).all();
        for (const row of rows) {
          if (!rotating && String(row.value).startsWith('v1:')) continue;
          jobs.push({ table, idColumn, field, row });
        }
      }
    }
    if (!jobs.length) {
      console.log('[db-admin] sensitive fields already encrypted');
      return;
    }
    encryptedSnapshot(db, 'before-field-encryption');
    db.transaction(() => {
      for (const { table, idColumn, field, row } of jobs) {
        const update = db.prepare(`UPDATE "${table}" SET "${field}"=? WHERE "${idColumn}"=?`);
        const plain = decryptField(String(row.value), old);
        update.run(encryptField(plain, current), row.id);
        changed++;
      }
    })();
    console.log(`[db-admin] encrypted/re-keyed ${changed} sensitive field values`);
  } finally {
    old.fill(0);
    if (current !== old) current.fill(0);
    db.close();
  }
}

function encryptFile(data, key) {
  if (data.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return data;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(FILE_MAGIC);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), ct]);
}

function migrateReceipts() {
  const root = resolve(process.env.ASTROLEDGER_UPLOADS_DIR || join(process.cwd(), 'uploads'));
  const key = masterKey();
  const db = openDatabase(dbPath(), true);
  let changed = 0;
  try {
    const rows = db.prepare('SELECT id, filePath FROM "Receipt"').all();
    const update = db.prepare('UPDATE "Receipt" SET filePath=? WHERE id=?');
    db.transaction(() => {
      for (const row of rows) {
        const oldPath = resolve(root, row.filePath);
        if (oldPath !== root && !oldPath.startsWith(root + '/')) continue;
        if (!existsSync(oldPath)) continue;
        const nextRel = row.filePath.endsWith('.enc') ? row.filePath : `${row.filePath}.enc`;
        const nextPath = resolve(root, nextRel);
        writeFileSync(nextPath, encryptFile(readFileSync(oldPath), key), { mode: 0o600 });
        chmodSync(nextPath, 0o600);
        if (nextPath !== oldPath) rmSync(oldPath, { force: true });
        update.run(nextRel, row.id);
        changed++;
      }
    })();
    console.log(`[db-admin] encrypted ${changed} receipt files`);
  } finally {
    key.fill(0);
    db.close();
  }
}

// The checked-in demo database is intentionally synthetic, but a static seed
// quickly makes the dashboard look abandoned. Rebase every numeric DATETIME
// column around the seed's latest transaction while the seed is still on
// tmpfs, then remove copied authentication sessions before it becomes the
// pristine per-visitor template. This command must only be used for DEMO_MODE.
function refreshDemoDates() {
  if (process.env.DEMO_MODE !== 'true') {
    throw new Error('refresh-demo-dates is restricted to DEMO_MODE=true');
  }
  const db = openDatabase(dbPath(), true);
  try {
    const latest = Number(db.prepare('SELECT max("date") AS latest FROM "Transaction"').get()?.latest);
    if (!Number.isFinite(latest) || latest <= 0) throw new Error('Demo seed has no transaction date anchor');

    const now = new Date();
    const target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
    const deltaMs = target - latest;
    const authTables = new Set(['Session', 'VerificationToken', 'Authenticator']);
    const tables = db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'`).all();
    let shiftedRows = 0;
    let shiftedColumns = 0;
    let clearedAuthRows = 0;

    db.transaction(() => {
      for (const table of authTables) {
        const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (exists) clearedAuthRows += db.prepare(`DELETE FROM ${sqlIdentifier(table)}`).run().changes;
      }
      for (const { name } of tables) {
        if (authTables.has(name)) continue;
        const columns = db.prepare(`PRAGMA table_info(${sqlIdentifier(name)})`).all();
        for (const column of columns) {
          if (!String(column.type).toUpperCase().includes('DATETIME')) continue;
          const ident = sqlIdentifier(column.name);
          const result = db.prepare(`UPDATE ${sqlIdentifier(name)}
            SET ${ident} = ${ident} + ?
            WHERE ${ident} IS NOT NULL AND typeof(${ident}) IN ('integer', 'real')`).run(deltaMs);
          if (result.changes > 0) {
            shiftedColumns++;
            shiftedRows += result.changes;
          }
        }
      }
    })();
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`[db-admin] demo dates refreshed (${shiftedRows} values across ${shiftedColumns} columns; ${clearedAuthRows} stale auth rows removed)`);
  } finally {
    db.close();
  }
}

function decryptBackup(blob, password) {
  if (blob.length < BACKUP_HEADER_LEN + 16 || !blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Not an Astroledger encrypted snapshot (bad magic)');
  }
  const header = blob.subarray(0, BACKUP_HEADER_LEN);
  const N = header.readUInt32BE(12), r = header.readUInt32BE(16), p = header.readUInt32BE(20);
  const salt = header.subarray(24, 40), iv = header.subarray(40, 52);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(BACKUP_HEADER_LEN, blob.length - 16);
  const key = scryptSync(Buffer.from(password.normalize('NFC')), salt, 32, { N, r, p, maxmem: 256 * N * r });
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return gunzipSync(Buffer.concat([decipher.update(ct), decipher.final()]));
  } finally {
    key.fill(0);
  }
}

function newestSnapshot() {
  const live = dbPath();
  const outDir = resolve(process.env.ASTROLEDGER_PRE_MIGRATE_DIR || join(dirname(live), 'pre-migrate'));
  if (!existsSync(outDir)) throw new Error(`Snapshot directory missing: ${outDir}`);
  const newest = readdirSync(outDir)
    .filter(name => name.endsWith('.db.enc'))
    .map(name => ({ name, mtime: statSync(join(outDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) throw new Error(`No .db.enc snapshots found in ${outDir}`);
  return join(outDir, newest.name);
}

// Open a restored scratch database. New snapshots have a plaintext inner
// payload; legacy snapshots (pre key-rotation support) inherited the database
// key that was current when they were taken — try the current key, then
// ASTROLEDGER_OLD_DB_KEY(_FILE) for snapshots that predate a rotation.
function openScratch(file) {
  if (isPlainSqlite(file)) return { db: openDatabase(file, false), keyed: 'plain' };
  try {
    return { db: openDatabase(file, true), keyed: 'current' };
  } catch {
    const oldSource = secret('ASTROLEDGER_OLD_DB_KEY_FILE', 'ASTROLEDGER_OLD_DB_KEY', false);
    if (!oldSource) {
      throw new Error('Snapshot is keyed with a different database key. For snapshots taken before a key rotation, set ASTROLEDGER_OLD_DB_KEY_FILE (or ASTROLEDGER_OLD_DB_KEY) to that previous key.');
    }
    const db = new Database(file);
    const key = keyFromSource(oldSource, 'astroledger-db-key-v1');
    try {
      db.key(key);
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch (error) {
      db.close();
      throw error;
    } finally {
      key.fill(0);
    }
    return { db, keyed: 'old' };
  }
}

/** Decrypt a snapshot into scratch and verify it. verifyOnly is the restore
 * drill: prove the backup opens and passes integrity, then delete the copy. */
function restore(file, { verifyOnly }) {
  const source = file ? resolve(file) : newestSnapshot();
  const password = secret('ASTROLEDGER_BACKUP_KEY_FILE', 'ASTROLEDGER_BACKUP_KEY');
  const live = dbPath();
  const scratch = resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR || dirname(live));
  mkdirSync(scratch, { recursive: true });
  const plain = join(scratch, `.astroledger-restore-${randomBytes(8).toString('hex')}.db`);
  try {
    writeFileSync(plain, decryptBackup(readFileSync(source), password), { mode: 0o600 });
    const { db, keyed } = openScratch(plain);
    let tables, integrity;
    try {
      integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`Snapshot integrity_check failed: ${integrity}`);
      tables = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get().c;
      if (verifyOnly) {
        console.log(`[db-admin] RESTORE DRILL OK: ${basename(source)} decrypts, passes integrity_check, ${tables} tables`);
        return;
      }
      // Whatever key (or none) the snapshot carried, the live file must end
      // up under the CURRENT database key.
      if (keyed !== 'current') {
        const key = dbKey();
        try {
          db.pragma('journal_mode = DELETE');
          db.rekey(key);
        } finally { key.fill(0); }
      }
    } finally {
      db.close();
    }
    if (isPlainSqlite(plain)) throw new Error('Restored copy is still plaintext after re-key');

    // Swap into place, retiring (not deleting) the current database.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const retired = `${live}.replaced-${stamp}`;
    if (existsSync(live)) renameSync(live, retired);
    rmSync(live + '-wal', { force: true });
    rmSync(live + '-shm', { force: true });
    copyFileSync(plain, live);
    chmodSync(live, 0o600);
    try {
      verify();
    } catch (error) {
      rmSync(live, { force: true });
      if (existsSync(retired)) renameSync(retired, live);
      throw error;
    }
    console.log(`[db-admin] restored ${basename(source)} (${tables} tables); previous database retired at ${retired}`);
    console.log('[db-admin] REMINDER: restore only with the app stopped, and restore a source tree compatible with this schema.');
  } finally {
    rmSync(plain, { force: true });
  }
}

/** Re-encrypt the whole database under a new key. Run with the app STOPPED.
 * The new key comes from ASTROLEDGER_NEW_DB_KEY_FILE (preferred) or
 * ASTROLEDGER_NEW_DB_KEY; after success, move it into the normal key file
 * location before starting the app. */
function rotateDbKey() {
  const nextSource = secret('ASTROLEDGER_NEW_DB_KEY_FILE', 'ASTROLEDGER_NEW_DB_KEY', false);
  if (!nextSource) throw new Error('ASTROLEDGER_NEW_DB_KEY_FILE (preferred) or ASTROLEDGER_NEW_DB_KEY is required');
  const live = dbPath();
  if (isPlainSqlite(live)) throw new Error('Database is plaintext; run migrate first');
  const db = openDatabase(live, true);
  const next = keyFromSource(nextSource, 'astroledger-db-key-v1');
  try {
    encryptedSnapshot(db, 'before-key-rotation');
    db.pragma('wal_checkpoint(TRUNCATE)');
    // Multiple-ciphers cannot re-key under WAL; switch, re-key, switch back.
    db.pragma('journal_mode = DELETE');
    db.rekey(next);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 8000');
  } finally {
    next.fill(0);
    db.close();
  }
  // Verify with the NEW key before declaring success.
  const check = new Database(live);
  const checkKey = keyFromSource(nextSource, 'astroledger-db-key-v1');
  try {
    check.key(checkKey);
    const result = check.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`Post-rotation integrity_check failed: ${result}`);
    const tables = check.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    console.log(`[db-admin] database key rotated and verified (${tables} tables)`);
    console.log('[db-admin] NEXT STEPS: replace the ASTROLEDGER_DB_KEY_FILE contents with the new key, then start the app.');
  } finally {
    checkKey.fill(0);
    check.close();
  }
}

const command = process.argv[2];
try {
  if (command === 'migrate') migrate();
  else if (command === 'verify') verify();
  else if (command === 'snapshot') snapshot();
  else if (command === 'baseline-all') baselineAll();
  else if (command === 'migrate-schema') migrateSchema();
  else if (command === 'migrate-fields') migrateFields();
  else if (command === 'migrate-receipts') migrateReceipts();
  else if (command === 'refresh-demo-dates') refreshDemoDates();
  else if (command === 'rotate-db-key') rotateDbKey();
  else if (command === 'restore') restore(process.argv[3], { verifyOnly: false });
  else if (command === 'restore-verify') restore(process.argv[3], { verifyOnly: true });
  else if (command === 'is-plaintext') process.exitCode = isPlainSqlite(dbPath()) ? 0 : 2;
  else throw new Error('Usage: db-encryption-admin.mjs migrate|verify|snapshot|baseline-all|migrate-schema|migrate-fields|migrate-receipts|refresh-demo-dates|rotate-db-key|restore <file>|restore-verify [file]|is-plaintext');
} catch (error) {
  console.error(`[db-admin] FATAL: ${error?.message || error}`);
  process.exitCode = 1;
}
