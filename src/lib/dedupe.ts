import { prisma } from './prisma';

export type DedupReport = {
  tags: { merged: number; kept: number; moves: number };
  subscriptions: { merged: number; kept: number; txReassigned: number };
  transactions: { flagged: number };
};

/**
 * Merge root-level tags whose names match case-insensitively. The OLDEST one
 * wins (lowest createdAt) - its children, transactions, and subscriptions
 * absorb the references of the loser(s), then the loser is deleted.
 *
 * Idempotent: safe to run repeatedly. Only touches root-level tags (parentId
 * null) since child tags are already uniqueness-constrained per-parent.
 */
export async function dedupTags(): Promise<DedupReport['tags']> {
  const roots = await prisma.tag.findMany({
    where: { parentId: null },
    orderBy: { createdAt: 'asc' },
  });
  const byName = new Map<string, typeof roots[number][]>();
  for (const t of roots) {
    const k = t.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(t);
  }

  let merged = 0, kept = 0, moves = 0;
  for (const [, group] of byName) {
    if (group.length < 2) { kept += 1; continue; }
    const [winner, ...losers] = group;
    kept += 1;
    for (const loser of losers) {
      // Re-point children to the winner
      const reparented = await prisma.tag.updateMany({
        where: { parentId: loser.id },
        data: { parentId: winner.id },
      });
      moves += reparented.count;

      // Re-point transactions: connect winner, disconnect loser
      const tagged = await prisma.transaction.findMany({
        where: { tags: { some: { id: loser.id } } },
        select: { id: true },
      });
      for (const t of tagged) {
        await prisma.transaction.update({
          where: { id: t.id },
          data: { tags: { connect: { id: winner.id }, disconnect: { id: loser.id } } },
        });
      }
      moves += tagged.length;

      // Re-point subscriptions
      const subTagged = await prisma.subscription.findMany({
        where: { tags: { some: { id: loser.id } } },
        select: { id: true },
      });
      for (const s of subTagged) {
        await prisma.subscription.update({
          where: { id: s.id },
          data: { tags: { connect: { id: winner.id }, disconnect: { id: loser.id } } },
        });
      }
      moves += subTagged.length;

      await prisma.tag.delete({ where: { id: loser.id } });
      merged += 1;
    }
  }
  return { merged, kept, moves };
}

/**
 * Merge near-duplicate subscriptions for the same merchant. Two subs are
 * considered duplicates when they share a merchant and:
 *   - cadenceDays differ by ≤ 4 days  (catches monthly variance)
 *   - amounts are within 15% of each other (catches price hikes / partial refunds)
 *
 * The OLDEST surviving active sub wins; loser's linked transactions get
 * re-pointed to the winner, loser's tags are unioned onto the winner, then
 * the loser is deleted.
 */
export async function dedupSubscriptions(): Promise<DedupReport['subscriptions']> {
  const subs = await prisma.subscription.findMany({
    include: { tags: { select: { id: true } } },
    orderBy: [{ merchant: 'asc' }, { createdAt: 'asc' }],
  });
  const byMerchant = new Map<string, typeof subs>();
  for (const s of subs) {
    const k = s.merchant.trim().toLowerCase();
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k)!.push(s);
  }

  let merged = 0, kept = 0, txReassigned = 0;
  const CADENCE_TOL = 4;
  const AMOUNT_TOL = 0.15;

  for (const [, group] of byMerchant) {
    if (group.length < 2) { kept += 1; continue; }

    // Union-find-lite: greedily merge into the first sub that matches.
    const survivors: typeof subs = [];
    for (const candidate of group) {
      const match = survivors.find(s =>
        Math.abs(s.cadenceDays - candidate.cadenceDays) <= CADENCE_TOL
        && Math.abs(s.amount - candidate.amount) / Math.max(s.amount, candidate.amount, 1) <= AMOUNT_TOL
      );
      if (!match) { survivors.push(candidate); continue; }

      // Reassign transactions
      const moved = await prisma.transaction.updateMany({
        where: { subscriptionId: candidate.id },
        data: { subscriptionId: match.id },
      });
      txReassigned += moved.count;

      // Union tags onto the winner
      const newTagIds = candidate.tags.map(t => t.id).filter(id => !match.tags.some(mt => mt.id === id));
      if (newTagIds.length > 0) {
        await prisma.subscription.update({
          where: { id: match.id },
          data: { tags: { connect: newTagIds.map(id => ({ id })) } },
        });
        match.tags.push(...newTagIds.map(id => ({ id })));
      }

      await prisma.subscription.delete({ where: { id: candidate.id } });
      merged += 1;
    }
    kept += survivors.length;
  }
  return { merged, kept, txReassigned };
}

/**
 * Flag cross-source duplicate transactions: same merchant, same date, same
 * absolute amount, but on different bank accounts. The most common case is a
 * PayPal/Venmo charge appearing both in the funding account AND the wallet
 * account, double-counting outflow.
 *
 * Marks the newer (or wallet-side) duplicate as `isTransfer = true` so it's
 * excluded from rollups but stays visible in the transactions list. Idempotent.
 */
export async function dedupCrossSourceTransactions(): Promise<DedupReport['transactions']> {
  const txs = await prisma.transaction.findMany({
    where: { isTransfer: false, merchant: { not: null } },
    select: { id: true, accountId: true, merchant: true, date: true, amount: true, createdAt: true,
              account: { select: { type: true } } },
    orderBy: { date: 'asc' },
  });

  // Bucket by (merchant + day + cents)
  const buckets = new Map<string, typeof txs>();
  for (const t of txs) {
    const key = `${(t.merchant ?? '').toLowerCase()}::${t.date.toISOString().slice(0, 10)}::${Math.round(t.amount * 100)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }

  let flagged = 0;
  for (const [, group] of buckets) {
    if (group.length < 2) continue;
    // Must be cross-account to count
    const accIds = new Set(group.map(g => g.accountId));
    if (accIds.size < 2) continue;

    // Prefer the bank-side one as canonical; flag the wallet/ecommerce ones.
    // Tiebreak by earliest createdAt.
    const sorted = [...group].sort((a, b) => {
      const aWallet = a.account.type === 'wallet' || a.account.type === 'ecommerce';
      const bWallet = b.account.type === 'wallet' || b.account.type === 'ecommerce';
      if (aWallet !== bWallet) return aWallet ? 1 : -1; // non-wallet first
      return +a.createdAt - +b.createdAt;               // older first
    });
    const [keeper, ...dupes] = sorted;
    void keeper;
    for (const d of dupes) {
      await prisma.transaction.update({
        where: { id: d.id },
        data: { isTransfer: true, notes: (d as { notes?: string | null }).notes ?? '[auto] cross-source duplicate' },
      });
      flagged += 1;
    }
  }
  return { flagged };
}

/** Run all dedupers in order. Tags first (so subs+txs see canonical tag IDs). */
export async function dedupAll(): Promise<DedupReport> {
  const tags = await dedupTags();
  const subscriptions = await dedupSubscriptions();
  const transactions = await dedupCrossSourceTransactions();
  return { tags, subscriptions, transactions };
}
