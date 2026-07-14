// Surface the ambiguous transfer candidates that pairCrossAccountTransfers
// abstains on (multiple same-amount inflows within the date window). Returns
// structured data so a UI can let the user pick the right pairing.

import { prisma } from './prisma';
import { randomUUID } from 'node:crypto';
import { extractMaskHints } from './accountMerge';
import { attachTransferTag } from './transferTag';

export type CandidateSide = {
  id: string;
  accountId: string;
  accountName: string;
  institution: string;
  date: string;          // YYYY-MM-DD
  amount: number;
  description: string;
  merchant: string | null;
  source: string;        // 'simplefin' | 'qif' | ...
  // Tier hint - which pass would have caught this if not ambiguous:
  //   'cc-payment'  → asset outflow + liability inflow (Pass 2 candidate)
  //   'generic'     → any asset↔asset (Pass 3 candidate)
  tier: 'cc-payment' | 'generic';
  // True when this candidate's account mask appears as a 4-digit suffix in the
  // OUTFLOW's description (e.g. outflow says "To 8060112588" and this
  // candidate is on Growth (2588)). Strong signal that this is the right pair.
  matchesHint?: boolean;
};

export type AmbiguousGroup = {
  outflow: CandidateSide;       // the "from" side we're trying to pair
  candidates: CandidateSide[];  // every plausible "to" side within the window
};

export async function findAmbiguousTransfers(opts: { rangeDays?: number } = {}): Promise<AmbiguousGroup[]> {
  const rangeDays = opts.rangeDays ?? 3;
  const { resolvedKind } = await import('./accountKind');

  // Hydrate every unpaired, non-dismissed transaction with its account.
  const rows = await prisma.transaction.findMany({
    where: {
      transferGroupId: null,
      pairingDismissed: false,
    },
    select: {
      id: true, accountId: true, date: true, amount: true,
      rawDescription: true, merchant: true,
      account: {
        select: {
          name: true, type: true, subtype: true, kind: true, mask: true,
          institution: { select: { name: true, source: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
  if (rows.length === 0) return [];

  const LIABILITY = new Set(['credit', 'loan']);

  // Bucket inflows by abs(amount) cents.
  const inflows = rows.filter(r => r.amount > 0);
  const inByCents = new Map<number, typeof inflows>();
  for (const t of inflows) {
    const k = Math.round(Math.abs(t.amount) * 100);
    if (!inByCents.has(k)) inByCents.set(k, []);
    inByCents.get(k)!.push(t);
  }

  const groups: AmbiguousGroup[] = [];
  const claimed = new Set<string>();

  for (const out of rows) {
    if (out.amount >= 0) continue;
    if (claimed.has(out.id)) continue;
    const k = Math.round(Math.abs(out.amount) * 100);
    const candidatesAll = (inByCents.get(k) ?? []).filter(c =>
      !claimed.has(c.id)
      && c.accountId !== out.accountId
      && Math.abs((+c.date - +out.date) / 86400000) <= rangeDays
    );
    if (candidatesAll.length < 2) continue; // 0 = no transfer; 1 = unambiguous, already paired by matcher

    const outKind = resolvedKind(out.account);
    // Extract 4-digit suffixes from the outflow's description so we can flag
    // any candidate whose account mask the outflow seems to reference.
    const outHints = extractMaskHints(out.rawDescription);

    const toSide = (t: typeof rows[number]): CandidateSide => {
      const kind = resolvedKind(t.account);
      const tier: CandidateSide['tier'] = LIABILITY.has(kind) ? 'cc-payment' : 'generic';
      // Hint match #1: outflow's description names this candidate's account mask.
      // Hint match #2: candidate's description names the outflow's account mask
      //                ("From XXXXX1011" on the receive side).
      const candMask = t.account.mask ?? null;
      const outMask = out.account.mask ?? null;
      const hintMatch =
        (!!candMask && outHints.includes(candMask)) ||
        (!!outMask && extractMaskHints(t.rawDescription).includes(outMask));
      return {
        id: t.id, accountId: t.accountId,
        accountName: t.account.name,
        institution: t.account.institution.name,
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        description: t.rawDescription ?? '',
        merchant: t.merchant ?? null,
        source: t.account.institution.source,
        tier,
        matchesHint: hintMatch,
      };
    };
    groups.push({
      outflow: { ...toSide(out), tier: LIABILITY.has(outKind) ? 'cc-payment' : 'generic' },
      candidates: candidatesAll.map(toSide).sort((a, b) => {
        // Hint-matches float to the top of the list.
        if (!!a.matchesHint !== !!b.matchesHint) return b.matchesHint ? 1 : -1;
        // Then by date proximity to the outflow.
        return Math.abs(new Date(a.date).getTime() - new Date(out.date).getTime())
             - Math.abs(new Date(b.date).getTime() - new Date(out.date).getTime());
      }),
    });
    // Don't claim - leaving claimed empty so an inflow could appear as a candidate for multiple
    // outflows the user might be reviewing.
  }
  return groups;
}

/** Pair two transactions as a manual user-confirmed transfer. */
export async function pairTransactionsManual(outflowId: string, inflowId: string): Promise<void> {
  if (outflowId === inflowId) throw new Error('Cannot pair a transaction with itself');
  const [out, inflow] = await Promise.all([
    prisma.transaction.findUnique({ where: { id: outflowId }, select: { id: true, accountId: true, amount: true, transferGroupId: true } }),
    prisma.transaction.findUnique({ where: { id: inflowId },  select: { id: true, accountId: true, amount: true, transferGroupId: true } }),
  ]);
  if (!out || !inflow) throw new Error('One or both transactions not found');
  if (out.accountId === inflow.accountId) throw new Error('Both rows are on the same account');
  if (out.transferGroupId || inflow.transferGroupId) throw new Error('At least one row is already part of a transfer pair');
  if (Math.sign(out.amount) === Math.sign(inflow.amount)) throw new Error('Both rows have the same sign - one must be outflow and the other inflow');

  const groupId = randomUUID();
  await prisma.transaction.updateMany({
    where: { id: { in: [outflowId, inflowId] } },
    data: { transferGroupId: groupId, isTransfer: true },
  });
  await attachTransferTag([outflowId, inflowId]);
}

/** Mark a set of transactions as "not a transfer" so the matcher stops suggesting them. */
export async function dismissPairingCandidates(txIds: string[]): Promise<{ updated: number }> {
  if (txIds.length === 0) return { updated: 0 };
  const res = await prisma.transaction.updateMany({
    where: { id: { in: txIds } },
    data: { pairingDismissed: true },
  });
  return { updated: res.count };
}

/** Undo a previously-confirmed transfer pair - clears both rows' transferGroupId and isTransfer flag, and removes the auto-applied Transfer tag. */
export async function unpairTransfer(transferGroupId: string): Promise<{ updated: number }> {
  // Capture the ids before nulling the group so we can detach the tag.
  const rows = await prisma.transaction.findMany({
    where: { transferGroupId },
    select: { id: true },
  });
  const res = await prisma.transaction.updateMany({
    where: { transferGroupId },
    data: { transferGroupId: null, isTransfer: false },
  });
  if (rows.length > 0) {
    const { getOrCreateTransferTagId } = await import('./transferTag');
    const tagId = await getOrCreateTransferTagId();
    for (const r of rows) {
      await prisma.transaction.update({
        where: { id: r.id },
        data: { tags: { disconnect: { id: tagId } } },
      }).catch(() => null);
    }
  }
  return { updated: res.count };
}
