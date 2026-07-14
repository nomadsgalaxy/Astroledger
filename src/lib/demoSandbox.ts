// Per-session sandbox lifecycle for the public demo at demo.astroledger.app.
//
// Each visitor gets their own SQLite copy (prisma/sandboxes/<id>.db) so edits
// don't collide. The sandbox id is the Auth.js session-token cookie (first
// 32 hex chars), so it's tied to the visitor's auth session that
// /api/demo/start-session minted.
//
// Lifecycle:
//   - First Prisma call from a visitor → copy _seed.db → <id>.db, spin up
//     PrismaClient, cache it.
//   - Subsequent calls → reuse cached client, bump lastUsed.
//   - Background sweep every 5 min drops clients idle > 30 min, deletes file.
//   - LRU cap at 50 active clients (≈ 50 × 15MB RAM).
//   - When the sandbox is GC'd the visitor's cookie becomes orphaned;
//     middleware's next redirect spins up a fresh sandbox transparently.
//
// Auth tables (User, Session, Account, VerificationToken) live INSIDE each
// sandbox: the seed already contains demo@astroledger.app, and start-session
// writes the Session row through the proxy so it lands in the right sandbox.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const SANDBOX_DIR = process.env.ASTROLEDGER_SANDBOX_DIR
  ? path.resolve(process.env.ASTROLEDGER_SANDBOX_DIR)
  : path.join(process.cwd(), 'prisma', 'sandboxes');
const SEED_DB = path.join(SANDBOX_DIR, '_seed.db');
const FALLBACK_SOURCE_DB = path.join(process.cwd(), 'prisma', 'demo.db');
const MAX_SANDBOXES = 50;
const IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type Entry = {
  client: PrismaClient | null;
  lastUsed: number;
  initialized: Promise<PrismaClient>;
};

const globalForSandbox = globalThis as unknown as {
  __astroSandboxes?: Map<string, Entry>;
  __astroSandboxSweep?: boolean;
};

const sandboxes: Map<string, Entry> = globalForSandbox.__astroSandboxes ??= new Map();

export function tokenToSandboxId(token: string): string {
  return token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

async function provisionFile(sandboxId: string): Promise<string> {
  await fs.mkdir(SANDBOX_DIR, { recursive: true });
  const dbFile = path.join(SANDBOX_DIR, `${sandboxId}.db`);
  try {
    await fs.access(dbFile);
    return dbFile;
  } catch { /* doesn't exist yet */ }

  // Prefer the pristine _seed.db snapshot; fall back to the live demo.db if
  // the snapshot is missing (first deploy before seed:demo wrote it).
  let source = SEED_DB;
  try { await fs.access(source); }
  catch { source = FALLBACK_SOURCE_DB; }
  await fs.copyFile(source, dbFile);
  await fs.chmod(dbFile, 0o600);
  return dbFile;
}

// `makeClient` is injected from lib/prisma.ts to avoid an import cycle - 
// the encryption-extended PrismaClient builder lives there.
let makeClient: ((url: string) => PrismaClient) | null = null;
export function registerClientFactory(factory: (url: string) => PrismaClient) {
  makeClient = factory;
}

async function evictOldestIfNeeded() {
  if (sandboxes.size <= MAX_SANDBOXES) return;
  let oldestKey: string | null = null;
  let oldestUsed = Infinity;
  for (const [k, v] of sandboxes) {
    if (v.lastUsed < oldestUsed) { oldestUsed = v.lastUsed; oldestKey = k; }
  }
  if (oldestKey) {
    const entry = sandboxes.get(oldestKey);
    sandboxes.delete(oldestKey);
    try { await entry?.client?.$disconnect(); } catch {}
    // Don't delete the .db file here - visitor's cookie may still be valid
    // and the next request will hydrate them anew from the file. The file
    // gets unlinked by the idle sweep after IDLE_MS.
  }
}

export async function getSandboxClient(token: string): Promise<PrismaClient> {
  if (!makeClient) throw new Error('lib/demoSandbox: registerClientFactory not called yet');
  const sandboxId = tokenToSandboxId(token);
  if (!sandboxId) throw new Error('lib/demoSandbox: empty sandboxId');

  let entry = sandboxes.get(sandboxId);
  if (!entry) {
    const factory = makeClient;
    const initialized = (async () => {
      const dbFile = await provisionFile(sandboxId);
      const url = 'file:' + dbFile.replace(/\\/g, '/');
      const client = factory(url);
      const e = sandboxes.get(sandboxId);
      if (e) e.client = client;
      return client;
    })();
    entry = { client: null, lastUsed: Date.now(), initialized };
    sandboxes.set(sandboxId, entry);
    await evictOldestIfNeeded();
  }
  const client = entry.client ?? (await entry.initialized);
  entry.lastUsed = Date.now();
  return client;
}

// Background sweep - Node-runtime only. Edge runtime has no setInterval-with-fs.
export function startSandboxSweep() {
  if (globalForSandbox.__astroSandboxSweep) return;
  globalForSandbox.__astroSandboxSweep = true;
  setInterval(async () => {
    const now = Date.now();
    for (const [id, entry] of [...sandboxes]) {
      if (now - entry.lastUsed > IDLE_MS) {
        sandboxes.delete(id);
        try { await entry.client?.$disconnect(); } catch {}
        try { await fs.unlink(path.join(SANDBOX_DIR, `${id}.db`)); } catch {}
      }
    }
  }, SWEEP_INTERVAL_MS).unref?.();
}
