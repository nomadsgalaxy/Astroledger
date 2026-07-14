import { PrismaClient } from '@prisma/client';
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3';
import { encrypt, decrypt } from './crypto';
import { getSandboxClient, registerClientFactory, startSandboxSweep } from './demoSandbox';
import { ACTIVE_SPACE_COOKIE, applyFinancialScope, resolveRequestAccess, resolveSystemFinancialAccess, type RequestAccess } from './financialAccess';

// Columns encrypted transparently at rest. Add to this list as new sensitive fields appear.
const ENCRYPTED: Record<string, string[]> = {
  Institution: ['accessToken'],
  Order: ['raw'],
  Account: ['refresh_token', 'access_token', 'id_token'],
};

function encryptFields(model: string, data: any) {
  if (!data) return;
  const fields = ENCRYPTED[model];
  if (!fields) return;
  for (const f of fields) {
    if (data[f] != null && typeof data[f] === 'string' && !data[f].startsWith('v1:')) {
      data[f] = encrypt(data[f]);
    }
  }
}

function decryptFields(model: string, row: any) {
  if (!row) return row;
  const fields = ENCRYPTED[model];
  if (!fields) return row;
  for (const f of fields) {
    if (row[f] != null && typeof row[f] === 'string') {
      try { row[f] = decrypt(row[f]); } catch { /* leave as-is */ }
    }
  }
  return row;
}

// Full-database encryption path. The adapter package is patched at install
// time to use better-sqlite3-multiple-ciphers and to apply the key before the
// first SQLite query. The patch fails closed when the key/driver is missing.
// timestampFormat preserves compatibility with rows written by Prisma's
// native SQLite engine before the encrypted-driver migration.
function buildEncryptedAdapter(url?: string): PrismaBetterSQLite3 | null {
  if (process.env.ASTROLEDGER_DB_ENCRYPTED !== 'true') return null;
  const dbUrl = url ?? process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  return new PrismaBetterSQLite3(
    { url: dbUrl },
    { timestampFormat: 'unixepoch-ms' },
  );
}

// Build a fresh extended PrismaClient. `url` overrides DATABASE_URL - used to
// point each demo-mode sandbox at its own SQLite file.
function makePrisma(url?: string): PrismaClient {
  const adapter = buildEncryptedAdapter(url);
  const opts: any = adapter
    ? { adapter }
    : url ? { datasources: { db: { url } } } : {};
  const base = new PrismaClient(opts);
  // Set a busy_timeout on the plain-SQLite connection so a query waits briefly
  // for a lock to clear instead of instantly failing with P1008 under
  // contention (the cause of the /forecast 503s). WAL mode (set in the Docker
  // entrypoint) makes reader/writer contention rare; this is the belt to that
  // suspenders. Fire-and-forget — never block client construction on it. The
  // SQLCipher adapter path manages its own connection, so skip it there.
  if (!adapter) {
    base.$executeRawUnsafe('PRAGMA busy_timeout=8000').catch(() => {});
  }
  return base.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          encryptFields(model, (args as any).data);
          const r = await query(args);
          return decryptFields(model, r);
        },
        async update({ model, args, query }) {
          encryptFields(model, (args as any).data);
          const r = await query(args);
          return decryptFields(model, r);
        },
        async upsert({ model, args, query }) {
          encryptFields(model, (args as any).create);
          encryptFields(model, (args as any).update);
          const r = await query(args);
          return decryptFields(model, r);
        },
        async findUnique({ model, args, query }) { return decryptFields(model, await query(args)); },
        async findFirst({ model, args, query })  { return decryptFields(model, await query(args)); },
        async findMany({ model, args, query }) {
          const rows = await query(args);
          return Array.isArray(rows) ? rows.map(r => decryptFields(model, r)) : rows;
        },
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Singleton - used outside DEMO_MODE, by CLI scripts, by background tasks, and
// as the fallback when cookies() isn't available (e.g. the hourly reset cron).
const singletonPrisma = globalForPrisma.prisma ?? makePrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = singletonPrisma;

const DEMO_MODE = process.env.DEMO_MODE === 'true';

const DENIED_ACCESS: RequestAccess = {
  userId: '__denied__', email: '', activeSpaceId: '__denied__', activeSpaceName: '', activeSpaceKind: 'none', role: 'viewer',
  spaceIds: [], summaryAccountIds: [], viewAccountIds: [], manageAccountIds: [], ownerAccountIds: [],
  documentViewAccountIds: [], documentManageAccountIds: [], exportAccountIds: [], shareAccountIds: [],
  canCreate: false, canAdminSpace: false, canViewDocuments: false, canManageDocuments: false,
  canExportSpace: false, canInvite: false,
};

type ScopedCacheEntry = { at: number; client: PrismaClient };
const scopedClients = new WeakMap<object, Map<string, ScopedCacheEntry>>();
let accessCacheEpoch = 0;

/** Permission-changing workflows call this so the next query re-resolves the
 * active membership/grant matrix instead of waiting for the tiny cache TTL. */
export function invalidateFinancialAccessCache() { accessCacheEpoch += 1; }

async function scopedClient(base: PrismaClient, token: string, activeSpaceId?: string): Promise<PrismaClient> {
  let cache = scopedClients.get(base as object);
  if (!cache) { cache = new Map(); scopedClients.set(base as object, cache); }
  const key = `${accessCacheEpoch}:${token}:${activeSpaceId ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 2_000) return hit.client;
  const access = await resolveRequestAccess(base, token, activeSpaceId).catch(() => null) ?? DENIED_ACCESS;
  const client = (base as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          return query(await applyFinancialScope(model, operation, args, access));
        },
      },
    },
  }) as PrismaClient;
  cache.clear();
  cache.set(key, { at: Date.now(), client });
  return client;
}

async function systemScopedClient(base: PrismaClient): Promise<PrismaClient> {
  let cache = scopedClients.get(base as object);
  if (!cache) { cache = new Map(); scopedClients.set(base as object, cache); }
  const key = `${accessCacheEpoch}:system`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 2_000) return hit.client;
  const access = await resolveSystemFinancialAccess(base);
  if (!access) return base; // pristine database before first-user setup
  const client = (base as any).$extends({
    query: { $allModels: { async $allOperations({ model, operation, args, query }: any) {
      return query(await applyFinancialScope(model, operation, args, access));
    } } },
  }) as PrismaClient;
  cache.clear();
  cache.set(key, { at: Date.now(), client });
  return client;
}

// Hook the sandbox lifecycle to this file's client factory + start the sweep.
if (DEMO_MODE) {
  registerClientFactory(makePrisma);
  startSandboxSweep();
}

// Resolve which PrismaClient this request should hit. Demo mode peeks at the
// Auth.js session-token cookie and routes to a per-visitor sandbox. Anywhere
// `cookies()` can't be called from (CLI tools, background workers), the
// dynamic-import + try/catch falls through to the singleton.
async function resolveClient(): Promise<PrismaClient> {
  let base = singletonPrisma;
  let token: string | undefined;
  let activeSpaceId: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    const c = await cookies();
    token = c.get('__Secure-authjs.session-token')?.value
         || c.get('authjs.session-token')?.value;
    activeSpaceId = c.get(ACTIVE_SPACE_COOKIE)?.value;
  } catch {
    return base;
  }
  // Calls without a browser session are trusted system jobs (migrations,
  // seeders, MCP/cron routes with their own token). A presented but invalid
  // session is fail-closed through DENIED_ACCESS.
  if (!token) {
    if (process.env.ASTROLEDGER_UNSCOPED_SYSTEM === 'true') return base;
    return systemScopedClient(base);
  }
  if (DEMO_MODE) {
    try { base = await getSandboxClient(token); }
    catch { return scopedClient(singletonPrisma, '__invalid_demo_session__', activeSpaceId); }
  }
  return scopedClient(base, token, activeSpaceId);
}

/** Resolve the full permission matrix for route handlers and server UI that
 * need to make an explicit capability decision (export, grants, documents). */
export async function getRequestFinancialAccess(): Promise<RequestAccess | null> {
  try {
    const { cookies } = await import('next/headers');
    const c = await cookies();
    const token = c.get('__Secure-authjs.session-token')?.value
      || c.get('authjs.session-token')?.value;
    if (!token) return null;
    let base = singletonPrisma;
    if (DEMO_MODE) base = await getSandboxClient(token);
    return resolveRequestAccess(base, token, c.get(ACTIVE_SPACE_COOKIE)?.value);
  } catch {
    return null;
  }
}

// Proxy wrapping the singleton's shape. Every property access either:
//   - returns a Promise (model methods, top-level $ helpers)
//   - returns a sub-Proxy that mirrors model methods
//
// Caveats:
//   - $transaction must use the interactive callback form. The inner `tx` is
//     the real client; array form cannot work because model calls through this
//     async Proxy resolve to ordinary Promises rather than PrismaPromise.
//   - prisma.<model>.fields (Prisma's typed field references) is rare and
//     would break; not used in Astroledger as of 2026-05.
//   - $disconnect on the Proxy is a no-op; sandbox clients are managed by
//     the lifecycle module.
function buildModelProxy(modelKey: string): any {
  return new Proxy({}, {
    get(_target, methodKey) {
      if (typeof methodKey === 'symbol') return undefined;
      return (...args: any[]) =>
        resolveClient().then(c => (c as any)[modelKey][methodKey](...args));
    },
  });
}

const proxiedPrisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (typeof prop === 'symbol') return undefined;

    if (prop === '$disconnect') {
      // No-op - sandbox clients are owned by the lifecycle module; the
      // singleton stays up for the process's lifetime.
      return async () => {};
    }
    if (prop === '$transaction') {
      return (...args: any[]) =>
        resolveClient().then(c => (c as any).$transaction(...args));
    }
    if (typeof prop === 'string' && prop.startsWith('$')) {
      return (...args: any[]) =>
        resolveClient().then(c => (c as any)[prop](...args));
    }

    return buildModelProxy(prop);
  },
});

// Always resolve through the request-aware proxy. Outside a request it falls
// through to the singleton, preserving CLI/background-job behavior.
export const prisma: PrismaClient = proxiedPrisma;
