// Shared connector-refresh loop. Both the manual refresh route
// (/api/institutions/sync, behind a session) and the scheduled cron
// (/api/cron/sync, behind CRON_SECRET) call this so the routing-by-source
// logic and the health bookkeeping live in exactly one place.
//
// Records per-institution health (lastSyncedAt / lastSyncStatus / lastSyncError)
// on every attempt. A connector throwing is caught, recorded, and turned into a
// row with an error — one bad bank never aborts the rest of the fleet.
//
// NOTE: this reads Institution.accessToken, which is decrypted by the Prisma
// client extension and therefore REQUIRES an unlocked vault. The session path
// unlocks it via the auth() session callback; the cron path must call
// unlockVault() (reads MASTER_KEY from env, no session needed) before invoking
// this. We assert that here so a locked-vault cron run fails loudly instead of
// silently recording auth_error against every institution.

import { prisma } from './prisma';
import { isVaultUnlocked } from './vault';
import { syncSimpleFin } from './simplefin';
import { syncPayPal } from './paypal';
import { syncTransactions as syncPlaid } from './plaid';
import { detectSubscriptions } from './detectSubscriptions';
import { buildRecommendations } from './recommend';
import { recordSyncSuccess, recordSyncError } from './syncHealth';

export type SyncRow = {
  institution: string;
  institutionId: string;
  source: string;
  added?: number;
  updated?: number;
  skipped?: boolean;
  error?: string;
};

export type SyncRunResult = {
  results: SyncRow[];
  totals: { added: number; updated: number; attempted: number; failed: number };
};

const LIVE_SOURCES = new Set(['simplefin', 'paypal', 'plaid']);

export async function runInstitutionSync(opts: {
  institutionId?: string;
  sinceDays?: number;
  /** Skip detectSubscriptions/buildRecommendations post-pass (cron does its own). */
  skipPostPass?: boolean;
} = {}): Promise<SyncRunResult> {
  if (!isVaultUnlocked()) {
    throw new Error('Vault is locked — cannot decrypt connector credentials. Set MASTER_KEY and unlock before syncing.');
  }

  const sinceDays = Math.max(1, Math.min(1095, opts.sinceDays ?? 365));
  const insts = opts.institutionId
    ? await prisma.institution.findMany({ where: { id: opts.institutionId } })
    : await prisma.institution.findMany();

  const results: SyncRow[] = [];
  let totalAdded = 0, totalUpdated = 0, failed = 0;

  for (const inst of insts) {
    if (!LIVE_SOURCES.has(inst.source)) {
      // csv / manual / quicken / amazon / pdf — no live source to pull from.
      results.push({ institution: inst.name, institutionId: inst.id, source: inst.source, skipped: true });
      continue;
    }
    try {
      let added = 0, updated = 0;
      if (inst.source === 'simplefin') {
        const r = await syncSimpleFin({ institutionId: inst.id, sinceDays });
        added = r.added; updated = r.updated;
        // SimpleFIN reports per-institution disconnects without throwing — a
        // disconnected leg means credentials were revoked, so record auth_error.
        const disc = r.disconnected?.find(d => d.institutionId === inst.id);
        if (disc) {
          await recordSyncError(inst.id, new Error(`401 ${disc.reason}`));
          results.push({ institution: inst.name, institutionId: inst.id, source: inst.source, error: disc.reason });
          failed++;
          continue;
        }
      } else if (inst.source === 'paypal') {
        const r = await syncPayPal({ institutionId: inst.id, sinceDays });
        added = r.added; updated = r.updated;
      } else if (inst.source === 'plaid') {
        const r = await syncPlaid(inst.id);
        added = (r as { added?: number }).added ?? 0;
        updated = (r as { updated?: number }).updated ?? 0;
      }
      totalAdded += added; totalUpdated += updated;
      await recordSyncSuccess(inst.id);
      results.push({ institution: inst.name, institutionId: inst.id, source: inst.source, added, updated });
    } catch (err) {
      await recordSyncError(inst.id, err);
      failed++;
      results.push({ institution: inst.name, institutionId: inst.id, source: inst.source, error: (err as Error).message });
    }
  }

  if (!opts.skipPostPass) {
    // Re-run detection + recs after a refresh so new tx surface in the right places.
    try { await detectSubscriptions(); } catch {}
    try { await buildRecommendations(); } catch {}
  }

  return {
    results,
    totals: { added: totalAdded, updated: totalUpdated, attempted: insts.length, failed },
  };
}
