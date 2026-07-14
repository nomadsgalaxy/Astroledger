// Derive whether an account should be auto-hidden because it has had no
// transaction activity for a configurable number of months.
//
// The threshold is stored in AppSetting under the key `auto_hide_inactive_months`:
//   "0"   → feature disabled, nothing is hidden
//   "N"   → accounts whose newest transaction is older than N months are hidden
//   unset → defaults to 12 months
//
// Pure derivation, no persistent column. Changing the threshold re-evaluates
// every account on the next read; no migration or backfill required.

import { prisma } from './prisma';
import { activeFinancialSpaceId } from './spaceContext';

export const DEFAULT_INACTIVE_MONTHS = 12;
export const SETTING_KEY = 'auto_hide_inactive_months';

export async function getInactiveMonths(): Promise<number> {
  const scopedKey = `space:${await activeFinancialSpaceId()}:${SETTING_KEY}`;
  const row = await prisma.appSetting.findUnique({ where: { key: scopedKey } })
    ?? await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return DEFAULT_INACTIVE_MONTHS;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INACTIVE_MONTHS;
}

export async function setInactiveMonths(months: number): Promise<void> {
  const clean = Math.max(0, Math.floor(months));
  const key = `space:${await activeFinancialSpaceId()}:${SETTING_KEY}`;
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(clean) },
    create: { key, value: String(clean) },
  });
}

/**
 * For a set of account ids, return a Map<accountId, latestTxDate | null>.
 * Single SQL query - uses Prisma's groupBy for efficiency on large DBs.
 */
export async function latestTxByAccount(accountIds: string[]): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>();
  for (const id of accountIds) out.set(id, null);
  if (accountIds.length === 0) return out;
  const rows = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accountIds } },
    _max: { date: true },
  });
  for (const r of rows) out.set(r.accountId, r._max.date ?? null);
  return out;
}

/**
 * Is this account considered stale right now? Returns true when:
 *   - threshold > 0 (feature is on), AND
 *   - the account's newest transaction is older than `thresholdMonths`, OR
 *     the account has zero transactions AND was created more than thresholdMonths ago.
 *
 * Newly-created accounts (< threshold old) with no transactions yet are NOT
 * hidden - give them a chance to sync something before disappearing.
 */
export function isStale(opts: {
  latestTx: Date | null;
  createdAt: Date;
  thresholdMonths: number;
  now?: Date;
}): boolean {
  if (opts.thresholdMonths <= 0) return false;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - opts.thresholdMonths);
  if (opts.latestTx) return opts.latestTx < cutoff;
  // No transactions ever - only hide if the account itself is older than the cutoff
  return opts.createdAt < cutoff;
}
