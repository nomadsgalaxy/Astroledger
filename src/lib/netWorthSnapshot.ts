// Daily net-worth snapshot. Run idempotently - re-running for the same UTC
// day overwrites the existing row with the latest figures.

import { prisma } from './prisma';
import { resolvedKind, isAsset } from './accountKind';
import { activeFinancialSpaceId } from './spaceContext';

export type SnapshotResult = { capturedAt: string; assets: number; liabilities: number; net: number; created: boolean };

export async function captureNetWorthSnapshot(opts: { day?: Date } = {}): Promise<SnapshotResult> {
  const spaceId = await activeFinancialSpaceId();
  const day = opts.day ?? new Date();
  const utcDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));

  const accounts = await prisma.bankAccount.findMany();
  let assets = 0, liabilities = 0;
  for (const a of accounts) {
    if (a.balance == null) continue;
    const k = resolvedKind(a);
    if (isAsset(k)) assets += a.balance;
    else liabilities += Math.abs(a.balance);
  }
  const net = assets - liabilities;

  const existing = await prisma.netWorthSnapshot.findUnique({ where: { spaceId_capturedAt: { spaceId, capturedAt: utcDay } } });
  if (existing) {
    await prisma.netWorthSnapshot.update({ where: { spaceId_capturedAt: { spaceId, capturedAt: utcDay } }, data: { assets, liabilities, net } });
    return { capturedAt: utcDay.toISOString(), assets, liabilities, net, created: false };
  }
  await prisma.netWorthSnapshot.create({ data: { spaceId, capturedAt: utcDay, assets, liabilities, net } });
  return { capturedAt: utcDay.toISOString(), assets, liabilities, net, created: true };
}

export async function listNetWorthHistory(opts: { days?: number } = {}): Promise<Array<{ date: string; assets: number; liabilities: number; net: number }>> {
  const since = new Date(Date.now() - (opts.days ?? 365) * 86400000);
  const rows = await prisma.netWorthSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: 'asc' },
  });
  return rows.map(r => ({
    date: r.capturedAt.toISOString().slice(0, 10),
    assets: r.assets, liabilities: r.liabilities, net: r.net,
  }));
}

// Reconstruct end-of-day net worth backward in time from current balances by
// undoing the per-account transactions that happened after each date. Useful
// when the snapshot table is sparse (fresh install, demo, post-import) so the
// chart shows actual movement instead of a single flat line.
//
// Caveat: market-driven changes in investment / retirement accounts aren't
// captured in Transaction rows, so reconstruction assumes those balances
// were always at their current level. Cash and credit accounts reconstruct
// exactly. Going forward, the daily snapshot table is the source of truth
// - this is a backfill for the gap between "now" and "earliest snapshot".
export async function reconstructNetWorthHistory(opts: { days?: number } = {}): Promise<Array<{ date: string; assets: number; liabilities: number; net: number }>> {
  const days = opts.days ?? 365;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDay = new Date(today.getTime() - days * 86400000);

  const accounts = await prisma.bankAccount.findMany();
  if (accounts.length === 0) return [];

  const txs = await prisma.transaction.findMany({
    where: { date: { gte: startDay } },
    select: { accountId: true, date: true, amount: true },
  });

  // Per-account daily net change keyed by ISO date string (YYYY-MM-DD)
  const accChanges = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (!t.accountId) continue;
    const dayKey = new Date(Date.UTC(
      t.date.getUTCFullYear(), t.date.getUTCMonth(), t.date.getUTCDate(),
    )).toISOString().slice(0, 10);
    let m = accChanges.get(t.accountId);
    if (!m) { m = new Map(); accChanges.set(t.accountId, m); }
    m.set(dayKey, (m.get(dayKey) ?? 0) + t.amount);
  }

  // Running per-account balance, walking back from today.
  // bal(d-1) = bal(d) - sum(transactions on day d)
  const balAt = new Map<string, number>();
  for (const a of accounts) balAt.set(a.id, a.balance ?? 0);

  const snapshots: Array<{ date: string; assets: number; liabilities: number; net: number }> = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    let assets = 0, liabilities = 0;
    for (const a of accounts) {
      if (a.balance == null) continue;
      const bal = balAt.get(a.id) ?? 0;
      const k = resolvedKind(a);
      if (isAsset(k)) assets += bal;
      else liabilities += Math.abs(bal);
    }
    snapshots.push({ date: key, assets, liabilities, net: assets - liabilities });
    // Step each account's running balance back one day for the next iteration.
    for (const a of accounts) {
      const m = accChanges.get(a.id);
      if (!m) continue;
      const change = m.get(key) ?? 0;
      balAt.set(a.id, (balAt.get(a.id) ?? 0) - change);
    }
  }
  snapshots.reverse();
  return snapshots;
}
