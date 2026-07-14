// Merge two BankAccount rows into one. All transactions, receipts, orders,
// subscriptions, and goals attached to the source move to the destination;
// the source row is then deleted.
//
// Dedup safety: if a source transaction's `hash` would collide with one
// already on the destination (same date+amount+description, normalized),
// the destination wins and the source row is dropped - it's the same
// real-world charge appearing under two account identities.
//
// Used by:
//   - the /accounts UI ("Merge into…" picker)
//   - the QIF/SimpleFIN/Plaid import paths via maskedLookup() when masks match

import { prisma } from './prisma';

// Require that the captured 4 digits be preceded by either start-of-string or
// a NON-digit (so "Upstart L3391147" does not yield mask=1147).
const MASK_RX = /(?:^|[^0-9])(?:xx|x|\*|·|\.|-|\s)*([0-9]{4})\s*$/i;

/**
 * Pull every 4-digit account-mask hint from a free-form description. Banks
 * routinely embed the OTHER side's account number in transfer descriptions:
 *   "Twh Auto Transfer To 8060112588"  → ["2588"]   (Growth mask)
 *   "Online Transfer From XXXXX0005"   → ["0005"]
 *   "Payment to 0123456789, 1234"      → ["6789", "1234"]
 *
 * Returns the LAST 4 digits of any 5+ digit numeric token, AND any standalone
 * 4-digit token. Returns an empty array when nothing parses.
 */
export function extractMaskHints(description: string | null | undefined): string[] {
  if (!description) return [];
  const hints: string[] = [];
  // Long numeric tokens - take the last 4 digits.
  const longNums = description.match(/\d{5,}/g) ?? [];
  for (const n of longNums) hints.push(n.slice(-4));
  // Standalone 4-digit tokens.
  const fourDigit = description.match(/(?:^|[^0-9])(\d{4})(?:[^0-9]|$)/g) ?? [];
  for (const raw of fourDigit) {
    const m = raw.match(/(\d{4})/);
    if (m) hints.push(m[1]);
  }
  // Dedupe while preserving order
  return [...new Set(hints)];
}

/**
 * Pull a 4-digit account mask out of a free-form name.
 *  "Fidelity ROTH IRA XX1625" → "1625"
 *  "Debit / Checking 2588"    → "2588"
 *  "PNC Cash Rewards Visa (3725)" → "3725"
 *  "American Airlines - 2506" → "2506"
 *  "Upstart L3391147"         → null   (long internal id, not a mask)
 *  "My Banks Growth"          → null
 */
export function extractMask(name: string): string | null {
  if (!name) return null;
  const noParens = name.replace(/[()]/g, ' ');
  const m = noParens.match(MASK_RX);
  return m ? m[1] : null;
}

/**
 * Find an existing account whose mask matches the one parsed out of the given
 * candidate name. Returns null when there's no mask or no unique match.
 */
export async function findAccountByMaskFromName(name: string): Promise<{ id: string; name: string } | null> {
  const mask = extractMask(name);
  if (!mask) return null;
  const matches = await prisma.bankAccount.findMany({
    where: { mask },
    select: { id: true, name: true },
  });
  if (matches.length === 1) return matches[0];
  // Multiple matches: try to disambiguate by institution name overlap.
  const lower = name.toLowerCase();
  const ranked = matches.map(m => ({
    ...m,
    score: lower.split(/\s+/).filter(w => w.length >= 3 && m.name.toLowerCase().includes(w)).length,
  })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0] : null;
}

export type MergeResult = {
  sourceId: string;
  destinationId: string;
  movedTransactions: number;
  droppedTransactions: number;     // dropped because they collided with an existing hash on the destination
  movedReceipts: number;
  movedOrders: number;
  movedSubscriptions: number;
  movedGoals: number;
};

/**
 * Move all data from `sourceId` to `destinationId` and delete the source row.
 * Runs in a single Prisma transaction. Returns counts per moved entity.
 */
export async function mergeAccounts(sourceId: string, destinationId: string): Promise<MergeResult> {
  if (sourceId === destinationId) throw new Error('Source and destination must differ');

  const [src, dst] = await Promise.all([
    prisma.bankAccount.findUnique({ where: { id: sourceId },     select: { id: true, name: true, mask: true, balance: true, balanceAsOf: true } }),
    prisma.bankAccount.findUnique({ where: { id: destinationId }, select: { id: true, name: true, mask: true, balance: true, balanceAsOf: true } }),
  ]);
  if (!src) throw new Error('Source account not found');
  if (!dst) throw new Error('Destination account not found');

  return prisma.$transaction(async (tx) => {
    // 1. Move transactions. Hash uniqueness can collide if the same charge
    //    landed on both accounts (rare but possible). Detect via existing
    //    hashes on the destination; drop the source row in that case so the
    //    user doesn't end up with two copies.
    const srcTxns = await tx.transaction.findMany({
      where: { accountId: sourceId },
      select: { id: true, hash: true },
    });
    const dstHashes = new Set((await tx.transaction.findMany({
      where: { accountId: destinationId },
      select: { hash: true },
    })).map(r => r.hash));

    const toMove   = srcTxns.filter(t => !dstHashes.has(t.hash)).map(t => t.id);
    const toDrop   = srcTxns.filter(t =>  dstHashes.has(t.hash)).map(t => t.id);

    if (toMove.length > 0) {
      await tx.transaction.updateMany({
        where: { id: { in: toMove } },
        data: { accountId: destinationId },
      });
    }
    if (toDrop.length > 0) {
      // Delete the colliding source txns. Receipts on them cascade-delete.
      await tx.transaction.deleteMany({ where: { id: { in: toDrop } } });
    }

    // 2. Receipts ride along with their transaction (no direct accountId column),
    //    so updating Transaction.accountId is enough. Count them for the report.
    const movedReceipts = await tx.receipt.count({
      where: { transactionId: { in: toMove } },
    });

    // 3. Orders may have an accountId column on some setups; Astroledger's Order
    //    model only references Transaction, so they ride along too. No-op here
    //    aside from the count.
    const movedOrders = await tx.order.count({
      where: { transactionId: { in: toMove } },
    });

    // 4. Goals can reference an account directly (goal.accountId). Reattach.
    const goalsRes = await tx.goal.updateMany({
      where: { accountId: sourceId },
      data: { accountId: destinationId },
    });

    // 5. Subscriptions have no account FK on Astroledger (they're merchant-scoped),
    //    so nothing to do - count 0.
    const movedSubscriptions = 0;

    // 6. Carry forward useful metadata onto the destination when missing.
    const inherit: Record<string, any> = {};
    if (!dst.mask && src.mask) inherit.mask = src.mask;
    // Keep the destination's balance if it has one and a recent timestamp;
    // otherwise inherit the source's balance.
    if ((dst.balance == null) && src.balance != null) {
      inherit.balance = src.balance;
      inherit.balanceAsOf = src.balanceAsOf ?? new Date();
    }
    if (Object.keys(inherit).length > 0) {
      await tx.bankAccount.update({ where: { id: destinationId }, data: inherit });
    }

    // 7. Finally, delete the now-empty source account.
    await tx.bankAccount.delete({ where: { id: sourceId } });

    return {
      sourceId, destinationId,
      movedTransactions: toMove.length,
      droppedTransactions: toDrop.length,
      movedReceipts,
      movedOrders,
      movedGoals: goalsRes.count,
      movedSubscriptions,
    };
  });
}
