// Automated DB backups.
//
// Strategy: SQLite's `VACUUM INTO 'path'` makes an atomic, consistent copy of
// the running database without holding writer locks long. Then gzip-compress
// the snapshot for ~5× space savings.
//
// IMPORTANT — backup confidentiality: the deployed multiple-ciphers driver
// preserves page encryption through `VACUUM INTO`, and production then wraps
// that snapshot in the independent password-based `.db.enc` envelope. Restore
// and verification also support older backups whose inner SQLite image was
// plaintext, but production never creates a new plaintext `.db.gz` backup.
//
// Retention: prune backups older than `retentionDays`. Always keeps at least one.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { prisma } from './prisma';

import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { backupPassword, databaseKey } from './keyMaterial';
import {
  encryptBackup, decryptBackup, detectFormat, assertStrongPassword,
  PasswordRequiredError, looksLikeSqlite,
} from './backupCrypto';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Cross-operation guard: a restore in progress must block the scheduled-backup
// tick from VACUUMing the live DB out from under the swap, and vice versa.
// Set/cleared by restoreBackup; checked by tick().
let restoreInProgress = false;

const KEY_ENABLED         = 'backup_enabled';
const KEY_INTERVAL_HOURS  = 'backup_interval_hours';
const KEY_RETENTION_DAYS  = 'backup_retention_days';
const KEY_DEST_DIR        = 'backup_dest_dir';
const KEY_LAST_RUN        = 'backup_last_run';
const KEY_LAST_RESULT     = 'backup_last_result';
const KEY_LAST_ERROR      = 'backup_last_error';

export type BackupConfig = {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  destDir: string;
};

// Default: write to a sibling of the DB file. In Docker that's /data/backups/.
function defaultDestDir(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  const filePath = url.replace(/^file:/, '');
  return path.join(path.dirname(path.resolve(filePath)), 'backups');
}

const DEFAULTS: BackupConfig = {
  enabled: false,
  intervalHours: 24,
  retentionDays: 30,
  destDir: defaultDestDir(),
};

export async function readBackupConfig(): Promise<BackupConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_ENABLED, KEY_INTERVAL_HOURS, KEY_RETENTION_DAYS, KEY_DEST_DIR] } },
  });
  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled:       (map.get(KEY_ENABLED) ?? String(DEFAULTS.enabled)) === 'true',
    intervalHours: parseFloat(map.get(KEY_INTERVAL_HOURS) ?? String(DEFAULTS.intervalHours)),
    retentionDays: parseInt(map.get(KEY_RETENTION_DAYS) ?? String(DEFAULTS.retentionDays)),
    destDir:        map.get(KEY_DEST_DIR) ?? DEFAULTS.destDir,
  };
}

export async function writeBackupConfig(patch: Partial<BackupConfig>): Promise<BackupConfig> {
  const pairs: Array<[string, string]> = [];
  if (patch.enabled       !== undefined) pairs.push([KEY_ENABLED,        String(patch.enabled)]);
  if (patch.intervalHours !== undefined) pairs.push([KEY_INTERVAL_HOURS, String(patch.intervalHours)]);
  if (patch.retentionDays !== undefined) pairs.push([KEY_RETENTION_DAYS, String(patch.retentionDays)]);
  if (patch.destDir       !== undefined) pairs.push([KEY_DEST_DIR,       String(patch.destDir)]);
  for (const [k, v] of pairs) {
    await prisma.appSetting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
  }
  await reconcileBackupScheduler();
  return readBackupConfig();
}

export type BackupStats = {
  filename: string;
  bytes: number;
  durationMs: number;
  pruned: number;
  encrypted: boolean;
};

export async function runBackup(opts?: { password?: string }): Promise<BackupStats> {
  const start = Date.now();
  const cfg = await readBackupConfig();
  await fs.mkdir(cfg.destDir, { recursive: true });

  // Production and encrypted-DB deployments never emit plaintext backups.
  // An explicit UI password takes precedence; scheduled jobs use the managed
  // backup secret injected through a file.
  const password = opts?.password || backupPassword() || undefined;
  if (!password && (process.env.NODE_ENV === 'production' || process.env.ASTROLEDGER_DB_ENCRYPTED === 'true')) {
    throw new PasswordRequiredError();
  }
  if (password) assertStrongPassword(password);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempName = `astroledger-${ts}.db`;
  const scratchDir = path.resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR ?? os.tmpdir());
  await fs.mkdir(scratchDir, { recursive: true });
  const tempPath = path.join(scratchDir, `${tempName}-${randomBytes(8).toString('hex')}`);
  const encrypted = !!password;
  const finalName = `astroledger-${ts}.db${encrypted ? '.enc' : '.gz'}`;
  const finalPath = path.join(cfg.destDir, finalName);

  // 1. VACUUM INTO - online consistent copy.
  // The path must be passed as a single-quoted SQL string, no parameter binding.
  // SQLite refuses if destination exists, so we use a temp name + remove on error.
  let payload: Buffer;
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`);

    // 2. gzip the snapshot, then wrap it before writing to persistent storage.
    const raw = await fs.readFile(tempPath);
    const gz  = await gzipAsync(raw);
    payload = encrypted ? await encryptBackup(gz, password!) : gz;
    await fs.writeFile(finalPath, payload, { mode: 0o600 });
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }

  // 2b. Off-machine mirror (R7). If ASTROLEDGER_BACKUP_MIRROR_DIR is set (a
  // mounted NAS share, synced cloud folder, USB path…), copy the finished
  // backup there so a single-disk failure doesn't lose every backup. Best-
  // effort: a mirror failure must not fail the primary backup, but it's logged
  // and (below) alerts like any backup problem.
  const mirrorDir = process.env.ASTROLEDGER_BACKUP_MIRROR_DIR;
  if (mirrorDir) {
    try {
      await fs.mkdir(mirrorDir, { recursive: true });
      await fs.copyFile(finalPath, path.join(mirrorDir, finalName));
    } catch (e) {
      console.error('[backup] mirror to', mirrorDir, 'failed:', (e as Error).message);
    }
  }

  // 3. Prune older than retentionDays. Always keep at least one.
  const cutoff = Date.now() - cfg.retentionDays * 86400000;
  const entries = (await fs.readdir(cfg.destDir))
    .filter(f => /^astroledger-.*\.db\.(gz|enc)$/.test(f))
    .map(f => ({ name: f, full: path.join(cfg.destDir, f) }));
  const stats = await Promise.all(entries.map(async e => ({ ...e, mtime: (await fs.stat(e.full)).mtimeMs })));
  stats.sort((a, b) => b.mtime - a.mtime);
  let pruned = 0;
  for (let i = 1; i < stats.length; i++) {     // i=1 keeps the newest regardless
    if (stats[i].mtime < cutoff) {
      await fs.unlink(stats[i].full);
      pruned++;
    }
  }

  const result: BackupStats = {
    filename: finalName,
    bytes: payload.length,
    durationMs: Date.now() - start,
    pruned,
    encrypted,
  };

  await prisma.appSetting.upsert({
    where: { key: KEY_LAST_RUN },
    update: { value: new Date().toISOString() },
    create: { key: KEY_LAST_RUN, value: new Date().toISOString() },
  });
  await prisma.appSetting.upsert({
    where: { key: KEY_LAST_RESULT },
    update: { value: JSON.stringify(result) },
    create: { key: KEY_LAST_RESULT, value: JSON.stringify(result) },
  });
  await prisma.appSetting.delete({ where: { key: KEY_LAST_ERROR } }).catch(() => {});
  return result;
}

export async function listBackups(): Promise<Array<{ name: string; bytes: number; mtime: string; encrypted: boolean }>> {
  const cfg = await readBackupConfig();
  try {
    const names = (await fs.readdir(cfg.destDir)).filter(f => /^astroledger-.*\.db\.(gz|enc)$/.test(f));
    const stats = await Promise.all(names.map(async name => {
      const st = await fs.stat(path.join(cfg.destDir, name));
      return { name, bytes: st.size, mtime: st.mtime.toISOString(), encrypted: name.endsWith('.db.enc') };
    }));
    return stats.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

// ---------- Restore ----------

function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  return path.resolve(url.replace(/^file:/, ''));
}

/**
 * Open a SQLite file read-only and run PRAGMA integrity_check + a sanity probe
 * (core tables present + non-trivial row count). Returns {ok, detail}. Uses the
 * better-sqlite3-multiple-ciphers driver already pulled in for the encrypted
 * path. `encrypted` applies the managed DB key before any query.
 */
export async function verifyDbFile(filePath: string, encrypted = false): Promise<{ ok: boolean; detail: string }> {
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      if (encrypted) {
        const key = databaseKey();
        try { db.key(key); } finally { key.fill(0); }
      }
      const integ = db.pragma('integrity_check', { simple: true });
      if (integ !== 'ok') return { ok: false, detail: `integrity_check: ${integ}` };
      const tbl = db.prepare(
        "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name IN ('Transaction','BankAccount','Institution')",
      ).get() as { c: number };
      if (!tbl || tbl.c < 3) return { ok: false, detail: `core tables missing (found ${tbl?.c ?? 0}/3)` };
      const tx = db.prepare('SELECT count(*) c FROM "Transaction"').get() as { c: number };
      return { ok: true, detail: `integrity ok, ${tx.c} transactions` };
    } finally {
      db.close();
    }
  } catch (e) {
    if (encrypted) return { ok: false, detail: `encrypted verify failed: ${(e as Error).message}` };
    // Driver unavailable — fall back to a header-magic check so we at least
    // refuse an obviously-corrupt/truncated file.
    try {
      const fh = await fs.open(filePath, 'r');
      const buf = Buffer.alloc(16);
      await fh.read(buf, 0, 16, 0);
      await fh.close();
      const header = buf.toString('utf8', 0, 15);
      if (header === 'SQLite format 3') {
        return { ok: true, detail: 'sqlite header ok (deep integrity_check unavailable — driver missing)' };
      }
      return { ok: false, detail: 'not a valid SQLite file (bad header)' };
    } catch (e2) {
      return { ok: false, detail: `verify failed: ${(e2 as Error).message}` };
    }
  }
}

export type RestoreResult = {
  restoredFrom: string;
  verify: { ok: boolean; detail: string };
  safetyCopy: string;
  swappedAt: string;
  encrypted: boolean;
};

// Validate a backup name + resolve it inside destDir. Shared by restore +
// verify. Rejects separators, bare `..`, and anything resolving outside.
function resolveBackupSrc(cfg: BackupConfig, backupName: string): string {
  if (!/^astroledger-[\w.\-:]+\.db\.(gz|enc)$/.test(backupName)
      || backupName.includes('/') || backupName.includes('\\') || backupName.includes('..')) {
    throw new Error(`Invalid backup name: ${backupName}`);
  }
  const src = path.join(cfg.destDir, backupName);
  if (path.dirname(path.resolve(src)) !== path.resolve(cfg.destDir)) {
    throw new Error(`Refusing to read from outside the backup directory: ${backupName}`);
  }
  return src;
}

// Read a backup file → the inner gzip blob, auto-detecting plain vs encrypted.
// Throws PasswordRequiredError if encrypted and no password given;
// BadPasswordError on wrong password; MalformedBackupError on unknown format.
async function readBackupGzip(src: string, password?: string): Promise<{ gz: Buffer; encrypted: boolean }> {
  const fileBuf = await fs.readFile(src);
  const { format } = detectFormat(fileBuf.subarray(0, 9));
  if (format === 'plain') return { gz: fileBuf, encrypted: false };
  // encrypted
  const effectivePassword = password || backupPassword() || undefined;
  if (!effectivePassword) throw new PasswordRequiredError();
  const gz = await decryptBackup(fileBuf, effectivePassword); // throws BadPasswordError on tag fail
  return { gz, encrypted: true };
}

/**
 * Restore the live DB from a `.db.gz` (plain) or `.db.enc` (password) backup:
 *   1. read + auto-detect format; decrypt if encrypted (needs password)
 *   2. gunzip to a temp file beside the live DB
 *   3. verify the temp file (integrity_check + core-table sanity) — ABORT if bad
 *   4. snapshot the CURRENT live DB to a safety copy (MANDATORY — abort if it fails)
 *   5. atomic rename-swap the verified file into place
 *
 * A single-restore lock prevents concurrent restores from racing the swap.
 * The caller MUST ensure the app/DB is quiescent — surfaced in the UI as
 * "this restarts the app." Returns paths for audit.
 */
export async function restoreBackup(backupName: string, password?: string): Promise<RestoreResult> {
  const cfg = await readBackupConfig();
  const src = resolveBackupSrc(cfg, backupName);
  await fs.access(src); // throws if missing

  const live = dbFilePath();
  const lockPath = live + '.restore.lock';
  // Exclusive lock: 'wx' fails if the file already exists. Self-heal a stale
  // lock from a crashed prior restore: if the lock file is older than 10
  // minutes (no restore takes that long), reclaim it rather than deadlock all
  // future restores. Addresses the "hung lock blocks forever" concern.
  let lockFh = await fs.open(lockPath, 'wx').catch(() => null);
  if (!lockFh) {
    const age = await fs.stat(lockPath).then(s => Date.now() - s.mtimeMs).catch(() => 0);
    if (age > 10 * 60_000) {
      await fs.unlink(lockPath).catch(() => {});
      lockFh = await fs.open(lockPath, 'wx').catch(() => null);
    }
    if (!lockFh) throw new Error('A restore is already in progress.');
  }
  restoreInProgress = true;

  const tmp = live + '.restore-tmp';
  const scratchDir = path.resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR ?? os.tmpdir());
  await fs.mkdir(scratchDir, { recursive: true });
  const plainTmp = path.join(scratchDir, `.astroledger-restore-${randomBytes(8).toString('hex')}.db`);
  const encryptedTmp = plainTmp + '.encrypted';
  const safety = live + '.pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try {
  // 1+2. read (decrypt if needed) → gunzip → tmp.
  // Defensive: clear any leftover tmp from a prior crashed restore so the
  // write below can't fail on a stale file.
  await fs.unlink(tmp).catch(() => {});
  await fs.unlink(plainTmp).catch(() => {});
  await fs.unlink(encryptedTmp).catch(() => {});
  const { gz, encrypted } = await readBackupGzip(src, password);
  const raw = await gunzipAsync(gz);
  // Current cipher-driver backups retain page encryption through VACUUM INTO.
  // Older archives contain plaintext SQLite. Support and verify both.
  const innerEncrypted = !looksLikeSqlite(raw);
  await fs.writeFile(plainTmp, raw, { mode: 0o600 });

  // 3. verify tmp — abort on failure (leave live DB untouched)
  const verify = await verifyDbFile(plainTmp, innerEncrypted);
  if (!verify.ok) {
    throw new Error(`Refusing to restore — backup failed verification: ${verify.detail}`);
  }

  // Re-encrypt while the plaintext exists only in tmpfs, then copy only the
  // encrypted file onto the persistent volume.
  if (process.env.ASTROLEDGER_DB_ENCRYPTED === 'true') {
    if (innerEncrypted) {
      await fs.copyFile(plainTmp, tmp);
    } else {
      await fs.copyFile(plainTmp, encryptedTmp);
      const key = databaseKey();
      try {
        const db = new Database(encryptedTmp);
        try { db.rekey(key); } finally { db.close(); }
      } finally {
        key.fill(0);
      }
      await fs.copyFile(encryptedTmp, tmp);
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to restore a plaintext database in production.');
    }
    await fs.copyFile(plainTmp, tmp);
  }

  // 3. safety-copy the current live DB. Raw-copying the encrypted live file
  //    preserves its page encryption; VACUUM INTO would emit plaintext.
  try {
    await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await fs.copyFile(live, safety);
  } catch {
    throw new Error('Refusing to restore — could not create a safety copy of the current database (VACUUM INTO and file copy both failed). Live DB left untouched.');
  }

  // 5. swap. Drop stale WAL/journal sidecars BEFORE the rename so there's no
  //    crash window where the new DB file coexists with the OLD file's journal
  //    (which SQLite would otherwise try to replay against it → corruption).
  //    The old sidecars belong to the file we're replacing; removing them
  //    first means the post-rename DB has no orphaned journal to recover from.
  await fs.unlink(live + '-journal').catch(() => {});
  await fs.unlink(live + '-wal').catch(() => {});
  await fs.unlink(live + '-shm').catch(() => {});
  // Atomic within a filesystem (tmp lives beside the live DB — same FS, no EXDEV).
  await fs.rename(tmp, live);

  return {
    restoredFrom: backupName,
    verify,
    safetyCopy: path.basename(safety),
    swappedAt: new Date().toISOString(),
    encrypted,
  };
  } finally {
    // Always release the single-restore lock + clean up any leftover temp.
    restoreInProgress = false;
    await lockFh.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    await fs.unlink(plainTmp).catch(() => {});
    await fs.unlink(encryptedTmp).catch(() => {});
  }
}

/**
 * Verify a backup is restorable WITHOUT touching the live DB: detect format →
 * decrypt (if encrypted, needs password) → gunzip → integrity_check against a
 * throwaway temp file. Lets users confirm a `.db.enc` decrypts + is sound (catch
 * a forgotten/typo'd password) before they ever depend on it.
 */
export async function verifyBackupFile(
  backupName: string,
  password?: string,
): Promise<{ ok: boolean; detail: string; encrypted: boolean }> {
  const cfg = await readBackupConfig();
  const src = resolveBackupSrc(cfg, backupName);
  await fs.access(src);
  const { gz, encrypted } = await readBackupGzip(src, password); // throws PasswordRequired/BadPassword
  const raw = await gunzipAsync(gz);
  const scratchDir = path.resolve(process.env.ASTROLEDGER_BACKUP_SCRATCH_DIR ?? os.tmpdir());
  await fs.mkdir(scratchDir, { recursive: true });
  const probe = path.join(scratchDir, `.astroledger-verify-${randomBytes(8).toString('hex')}.db`);
  try {
    await fs.writeFile(probe, raw);
    const v = await verifyDbFile(probe, !looksLikeSqlite(raw));
    return { ok: v.ok, detail: v.detail, encrypted };
  } finally {
    await fs.unlink(probe).catch(() => {});
  }
}

export async function readLastBackup() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_LAST_RUN, KEY_LAST_RESULT, KEY_LAST_ERROR] } },
  });
  const m = new Map(rows.map(r => [r.key, r.value]));
  return {
    lastRunAt:  m.get(KEY_LAST_RUN) ?? null,
    lastResult: m.get(KEY_LAST_RESULT) ? JSON.parse(m.get(KEY_LAST_RESULT)!) : null,
    lastError:  m.get(KEY_LAST_ERROR) ?? null,
  };
}

// ---------- Scheduler ----------
let timer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;
let inFlight = false;

async function tick() {
  if (inFlight) return;
  // Don't VACUUM the live DB while a restore is swapping it out — skip this
  // interval; the next tick will catch up.
  if (restoreInProgress) return;
  inFlight = true;
  try {
    const cfg = await readBackupConfig();
    if (!cfg.enabled) return;
    if (restoreInProgress) return; // re-check after the await
    await runBackup();
  } catch (e: any) {
    await prisma.appSetting.upsert({
      where: { key: KEY_LAST_ERROR },
      update: { value: e.message ?? String(e) },
      create: { key: KEY_LAST_ERROR, value: e.message ?? String(e) },
    });
    console.error('[backup] failed:', e.message ?? e);
    await alertBackupFailure(e?.message ?? String(e));
  } finally {
    inFlight = false;
  }
}

// Backup-failure alert (R8). A silent backup failure is the worst kind — you
// only learn the backup was broken when you need to restore. If
// ASTROLEDGER_ALERT_WEBHOOK is configured (Slack/Discord/ntfy/any JSON sink),
// POST a short notice. Always logged regardless. Best-effort + bounded timeout.
async function alertBackupFailure(message: string): Promise<void> {
  const url = process.env.ASTROLEDGER_ALERT_WEBHOOK;
  if (!url) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `⚠ Astroledger automated backup failed: ${message}`.slice(0, 500) }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  } catch (e) {
    console.error('[backup] alert webhook failed:', (e as Error).message);
  }
}

export async function reconcileBackupScheduler() {
  const cfg = await readBackupConfig();
  const wantMs = cfg.enabled ? Math.max(0.5, cfg.intervalHours) * 3600_000 : 0;
  if (wantMs === currentIntervalMs) return { running: !!timer, intervalHours: cfg.intervalHours };
  if (timer) { clearInterval(timer); timer = null; currentIntervalMs = 0; }
  if (wantMs > 0) {
    timer = setInterval(tick, wantMs);
    currentIntervalMs = wantMs;
  }
  return { running: !!timer, intervalHours: cfg.intervalHours };
}

let initialized = false;
export async function initBackupSchedulerOnce() {
  if (initialized) return;
  initialized = true;
  await reconcileBackupScheduler();
}
