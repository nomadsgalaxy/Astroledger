// Singleton scheduler for automatic Gmail sync.
// Runs on a setInterval bound to the Node process. Idempotent init so HMR or
// repeated server entry points don't spawn duplicate timers.
//
// Storage: AppSetting rows persist enabled/interval/last-run across restarts.
// Source-of-truth for config; env vars provide initial defaults only.

import { prisma } from './prisma';
import { listReceiptMessageIds, fetchMessage } from './gmail';
import { parseReceipt } from './receiptParse';
import { matchOrders } from './orderMatcher';
import { detectSubscriptions } from './detectSubscriptions';
import { buildRecommendations } from './recommend';
import { classifyReceipt, applyVerdict } from './subsLlmDetect';
import { activeFinancialSpaceId } from './spaceContext';

const KEY_ENABLED    = 'gmail_auto_sync_enabled';
const KEY_INTERVAL   = 'gmail_auto_sync_interval_min';
const KEY_MAX_PER    = 'gmail_auto_sync_max_per_run';
const KEY_LOOKBACK   = 'gmail_auto_sync_lookback_days';
const KEY_LAST_RUN   = 'gmail_auto_sync_last_run';
const KEY_LAST_STATS = 'gmail_auto_sync_last_stats';
const KEY_LAST_ERROR = 'gmail_auto_sync_last_error';
const KEY_USE_LLM    = 'gmail_auto_sync_use_llm';

export type AutoSyncConfig = {
  enabled: boolean;
  intervalMin: number;
  maxPerRun: number;
  lookbackDays: number;
  useLlm: boolean;
};

const DEFAULTS: AutoSyncConfig = {
  enabled: false,
  intervalMin: 60,
  maxPerRun: 50,
  lookbackDays: 7,
  useLlm: true,
};

export async function readConfig(): Promise<AutoSyncConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_ENABLED, KEY_INTERVAL, KEY_MAX_PER, KEY_LOOKBACK, KEY_USE_LLM] } },
  });
  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled:      (map.get(KEY_ENABLED)  ?? String(DEFAULTS.enabled))      === 'true',
    intervalMin:  parseInt(map.get(KEY_INTERVAL)  ?? String(DEFAULTS.intervalMin)),
    maxPerRun:    parseInt(map.get(KEY_MAX_PER)   ?? String(DEFAULTS.maxPerRun)),
    lookbackDays: parseInt(map.get(KEY_LOOKBACK)  ?? String(DEFAULTS.lookbackDays)),
    useLlm:       (map.get(KEY_USE_LLM)  ?? String(DEFAULTS.useLlm))       === 'true',
  };
}

export async function writeConfig(patch: Partial<AutoSyncConfig>): Promise<AutoSyncConfig> {
  const pairs: Array<[string, string]> = [];
  if (patch.enabled      !== undefined) pairs.push([KEY_ENABLED,  String(patch.enabled)]);
  if (patch.intervalMin  !== undefined) pairs.push([KEY_INTERVAL, String(patch.intervalMin)]);
  if (patch.maxPerRun    !== undefined) pairs.push([KEY_MAX_PER,  String(patch.maxPerRun)]);
  if (patch.lookbackDays !== undefined) pairs.push([KEY_LOOKBACK, String(patch.lookbackDays)]);
  if (patch.useLlm       !== undefined) pairs.push([KEY_USE_LLM,  String(patch.useLlm)]);
  for (const [k, v] of pairs) {
    await prisma.appSetting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
  }
  // Reconcile scheduler with new config.
  await reconcile();
  return readConfig();
}

export type AutoSyncStats = {
  scanned: number;
  newOrders: number;
  skipped: number;
  failed: number;
  matched: number;
  llmFlags: number;
  llmMatches: number;
  durationMs: number;
};

// Run one auto-sync cycle. Returns stats. Caller is responsible for catching.
export async function runAutoSync(): Promise<AutoSyncStats> {
  const spaceId = await activeFinancialSpaceId();
  const start = Date.now();
  const config = await readConfig();

  // Pick a user whose Google account we'll scan. Admin first, then first user.
  const adminUser = await prisma.user.findFirst({ where: { isAdmin: true } });
  const user = adminUser ?? await prisma.user.findFirst();
  if (!user) throw new Error('No user configured - sign in via Google once first.');

  const ids = await listReceiptMessageIds(user.id, {
    sinceDays: config.lookbackDays,
    max: config.maxPerRun,
  });
  const existing = await prisma.order.findMany({
    where: { source: 'gmail', externalId: { in: ids } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map(e => e.externalId));
  const todo = ids.filter(id => !seen.has(id));

  let newOrders = 0, skipped = 0, failed = 0, llmFlags = 0, llmMatches = 0;
  const BATCH = 10;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const out = await Promise.allSettled(slice.map(async id => {
      const msg = await fetchMessage(user.id, id);
      const draft = parseReceipt(msg);
      if (!draft) return { kind: 'skipped' as const };
      const order = await prisma.order.upsert({
        where: { spaceId_source_externalId: { spaceId, source: 'gmail', externalId: id } },
        create: {
          spaceId, source: 'gmail', externalId: id, merchant: draft.merchant,
          orderDate: draft.orderDate, amount: draft.amount, currency: draft.currency,
          items: draft.items ? JSON.stringify(draft.items) : null,
          url: draft.url,
        },
        update: { amount: draft.amount, merchant: draft.merchant },
      });

      let llmKind: 'none' | 'flagged' | 'matched' = 'none';
      if (config.useLlm) {
        const verdict = await classifyReceipt({
          merchant: draft.merchant, amount: draft.amount, source: 'gmail',
          items: draft.items?.map(it => ({ name: it.name })),
        });
        if (verdict) {
          const applied = await applyVerdict(verdict, order.id);
          if (applied?.kind === 'matched') llmKind = 'matched';
          else if (applied?.kind === 'flagged') llmKind = 'flagged';
        }
      }
      return { kind: 'imported' as const, llmKind };
    }));
    for (const r of out) {
      if (r.status === 'rejected') { failed++; continue; }
      if (r.value.kind === 'imported') {
        newOrders++;
        if ((r.value as any).llmKind === 'flagged') llmFlags++;
        else if ((r.value as any).llmKind === 'matched') llmMatches++;
      } else skipped++;
    }
  }

  const m = await matchOrders();
  await detectSubscriptions();
  await buildRecommendations();

  const stats: AutoSyncStats = {
    scanned: ids.length, newOrders, skipped, failed, matched: m.matched,
    llmFlags, llmMatches, durationMs: Date.now() - start,
  };

  await prisma.appSetting.upsert({
    where: { key: KEY_LAST_RUN }, update: { value: new Date().toISOString() },
    create: { key: KEY_LAST_RUN, value: new Date().toISOString() },
  });
  await prisma.appSetting.upsert({
    where: { key: KEY_LAST_STATS }, update: { value: JSON.stringify(stats) },
    create: { key: KEY_LAST_STATS, value: JSON.stringify(stats) },
  });
  await prisma.appSetting.delete({ where: { key: KEY_LAST_ERROR } }).catch(() => {});
  return stats;
}

// ---------- Scheduler singleton ----------
let timer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;
let inFlight = false;

async function tick() {
  if (inFlight) return; // skip if previous run still going
  inFlight = true;
  try {
    const cfg = await readConfig();
    if (!cfg.enabled) return;
    await runAutoSync();
  } catch (e: any) {
    await prisma.appSetting.upsert({
      where: { key: KEY_LAST_ERROR }, update: { value: e.message ?? String(e) },
      create: { key: KEY_LAST_ERROR, value: e.message ?? String(e) },
    });
    console.error('[gmailScheduler] auto sync failed:', e.message ?? e);
  } finally {
    inFlight = false;
  }
}

export async function reconcile(): Promise<{ running: boolean; intervalMin: number }> {
  const cfg = await readConfig();
  const wantMs = cfg.enabled ? Math.max(5, cfg.intervalMin) * 60_000 : 0;
  if (wantMs === currentIntervalMs) return { running: !!timer, intervalMin: cfg.intervalMin };
  if (timer) { clearInterval(timer); timer = null; currentIntervalMs = 0; }
  if (wantMs > 0) {
    timer = setInterval(tick, wantMs);
    currentIntervalMs = wantMs;
  }
  return { running: !!timer, intervalMin: cfg.intervalMin };
}

let initialized = false;
export async function initSchedulerOnce() {
  if (initialized) return;
  initialized = true;
  await reconcile();
}

export async function readLastRun() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_LAST_RUN, KEY_LAST_STATS, KEY_LAST_ERROR] } },
  });
  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    lastRunAt: map.get(KEY_LAST_RUN) ?? null,
    lastStats: map.get(KEY_LAST_STATS) ? JSON.parse(map.get(KEY_LAST_STATS)!) : null,
    lastError: map.get(KEY_LAST_ERROR) ?? null,
  };
}
