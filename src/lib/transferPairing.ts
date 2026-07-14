import { prisma } from './prisma';
import { randomUUID } from 'node:crypto';
import { resolvedKind } from './accountKind';
import { extractMaskHints } from './accountMerge';
import { attachTransferTag } from './transferTag';

export type PairingResult = {
  paired: number;        // # of pairs created (i.e. 2 tx each)
  alreadyPaired: number; // # of tx skipped because already paired
  ambiguous: number;     // # of tx with multiple candidates
  ccPayments: number;    // subset of `paired` that were detected via the credit-card-payment heuristic
  oneSidedFlagged: number; // # of outflows flagged isTransfer without a counterpart (Pass 4 mention-based)
  rangeDays: number;
};

// Description fragments that strongly imply an inter-account move
const TRANSFER_HINTS = /\b(transfer|xfer|wallet|to\s+(spend|growth|reserve)|from\s+(spend|growth|reserve)|inst\s*xfer|internal\s+transfer|account\s+transfer)\b/i;

// Kinds whose balance moves DOWN when the user pays them - credit cards and
// loans. A positive amount on these accounts means "debt reduced", not income.
// We use the *resolved* kind (user-set OR name-inferred) rather than the raw
// source `type`, because SimpleFIN hardcodes everything as 'depository' even
// for credit cards - the AA card sample exposed this.
const LIABILITY_KINDS = new Set(['credit', 'loan']);
// Kinds money typically MOVES FROM when paying a credit card.
const ASSET_KINDS = new Set(['checking', 'savings_short', 'savings_long', 'wallet', 'investment']);

/**
 * Pair up transactions that look like cross-account transfers between the
 * user's own accounts. A "pair" is two transactions where:
 *   - they live on DIFFERENT bank accounts (same institution OK)
 *   - their amounts are exactly opposite sign + equal absolute value
 *   - their dates are within ±rangeDays of each other (default 2)
 *   - at least one side's description hints at a transfer (or both are flagged
 *     isTransfer already)
 *
 * Both rows get the same `transferGroupId` (UUIDv4) and `isTransfer = true`.
 * Rollups should already exclude `isTransfer = true` rows; the groupId lets the
 * UI link the two sides together.
 *
 * Idempotent - already-grouped rows are skipped on subsequent runs.
 */
export async function pairCrossAccountTransfers(opts: { rangeDays?: number } = {}): Promise<PairingResult> {
  const rangeDays = opts.rangeDays ?? 2;

  // Pull every unpaired tx with a transfer-ish hint OR already-flagged isTransfer
  // Going by sign: candidate outflow tries to match a candidate inflow.
  const candidates = await prisma.transaction.findMany({
    where: {
      transferGroupId: null,
      pairingDismissed: false,
      OR: [
        { isTransfer: true },
        { rawDescription: { contains: 'transfer' } },
        { rawDescription: { contains: 'Transfer' } },
        { rawDescription: { contains: 'Xfer' } },
        { rawDescription: { contains: 'xfer' } },
        { rawDescription: { contains: 'Wallet' } },
      ],
    },
    select: { id: true, accountId: true, date: true, amount: true, rawDescription: true, merchant: true },
    orderBy: { date: 'asc' },
  });

  // Group by absolute amount (rounded cents) for quick same-amount lookups
  const byAmount = new Map<number, typeof candidates>();
  for (const t of candidates) {
    const k = Math.round(Math.abs(t.amount) * 100);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(t);
  }

  let paired = 0, alreadyPaired = 0, ambiguous = 0, ccPayments = 0, oneSidedFlagged = 0;
  const claimed = new Set<string>();

  for (const out of candidates) {
    if (out.amount >= 0) continue;                  // start from the outflow side
    if (claimed.has(out.id)) { alreadyPaired++; continue; }

    const k = Math.round(Math.abs(out.amount) * 100);
    const sameAmount = byAmount.get(k) ?? [];
    // Find an inflow on a DIFFERENT account within ±rangeDays
    const matches = sameAmount.filter(c =>
      c.amount > 0
      && c.accountId !== out.accountId
      && !claimed.has(c.id)
      && Math.abs((+c.date - +out.date) / 86400000) <= rangeDays
    );
    if (matches.length === 0) continue;
    // Require a hint on at least one side to avoid pairing random equal amounts
    const hasHint = TRANSFER_HINTS.test(out.rawDescription ?? '')
      || TRANSFER_HINTS.test(out.merchant ?? '')
      || matches.some(m => TRANSFER_HINTS.test(m.rawDescription ?? '') || TRANSFER_HINTS.test(m.merchant ?? ''));
    if (!hasHint) continue;

    if (matches.length > 1) { ambiguous++; continue; } // skip ambiguous; user can pair manually later

    const inflow = matches[0];
    const groupId = randomUUID();
    await prisma.transaction.updateMany({
      where: { id: { in: [out.id, inflow.id] } },
      data: { transferGroupId: groupId, isTransfer: true },
    });
    await attachTransferTag([out.id, inflow.id]);
    claimed.add(out.id); claimed.add(inflow.id);
    paired += 1;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 2: credit-card / loan payments.
  // A positive amount on a credit-type or loan-type account is NOT income - 
  // it's debt reduction. If we find a matching negative outflow on a
  // depository/wallet account within ±rangeDays, it's a payment transfer.
  // Description hints not required; the account-type combo is the signal.
  // ────────────────────────────────────────────────────────────────────────
  const accountsMeta = await prisma.bankAccount.findMany({
    select: { id: true, type: true, subtype: true, kind: true, name: true, mask: true },
  });
  // resolvedKind respects the user-set `kind` column first, then falls back
  // to type/subtype/name keyword inference (so "American Airlines Card" →
  // 'credit' even when SimpleFIN typed it 'depository').
  const liabilityAccountIds = accountsMeta.filter(a => LIABILITY_KINDS.has(resolvedKind(a))).map(a => a.id);
  const assetAccountIds     = accountsMeta.filter(a => ASSET_KINDS.has(resolvedKind(a))).map(a => a.id);

  if (liabilityAccountIds.length > 0 && assetAccountIds.length > 0) {
    // Unpaired positive amounts on liability accounts (potential CC payments received)
    const liabilityInflows = await prisma.transaction.findMany({
      where: {
        transferGroupId: null,
        pairingDismissed: false,
        accountId: { in: liabilityAccountIds },
        amount: { gt: 0 },
        // Refunds vs payments: the matcher requires a same-amount outflow on
        // an asset account - refunds have no such counterpart, so they fall
        // through without false-positiving. Keep the where filter loose.
      },
      select: { id: true, accountId: true, date: true, amount: true, rawDescription: true, merchant: true },
      orderBy: { date: 'asc' },
    });
    if (liabilityInflows.length > 0) {
      // Pull asset-account outflows in the relevant date window, grouped by abs(amount).
      const oldest = new Date(Math.min(...liabilityInflows.map(t => +t.date)));
      const newest = new Date(Math.max(...liabilityInflows.map(t => +t.date)));
      const since = new Date(+oldest - rangeDays * 86400000);
      const until = new Date(+newest + rangeDays * 86400000);
      const assetOutflows = await prisma.transaction.findMany({
        where: {
          transferGroupId: null,
          accountId: { in: assetAccountIds },
          amount: { lt: 0 },
          date: { gte: since, lte: until },
        },
        select: { id: true, accountId: true, date: true, amount: true, rawDescription: true, merchant: true },
      });
      const outByAmount = new Map<number, typeof assetOutflows>();
      for (const t of assetOutflows) {
        const k = Math.round(Math.abs(t.amount) * 100);
        if (!outByAmount.has(k)) outByAmount.set(k, []);
        outByAmount.get(k)!.push(t);
      }

      for (const inflow of liabilityInflows) {
        if (claimed.has(inflow.id)) continue;
        const k = Math.round(Math.abs(inflow.amount) * 100);
        const candidates2 = (outByAmount.get(k) ?? []).filter(c =>
          !claimed.has(c.id)
          && Math.abs((+c.date - +inflow.date) / 86400000) <= rangeDays
        );
        if (candidates2.length === 0) continue;
        if (candidates2.length > 1) {
          // Prefer the closest date if multiple matches; ties go to ambiguous.
          candidates2.sort((a, b) => Math.abs(+a.date - +inflow.date) - Math.abs(+b.date - +inflow.date));
          const a = candidates2[0], b = candidates2[1];
          if (a && b && Math.abs(+a.date - +inflow.date) === Math.abs(+b.date - +inflow.date)) {
            ambiguous++; continue;
          }
        }
        const out = candidates2[0];
        const groupId = randomUUID();
        await prisma.transaction.updateMany({
          where: { id: { in: [inflow.id, out.id] } },
          data: { transferGroupId: groupId, isTransfer: true },
        });
        await attachTransferTag([inflow.id, out.id]);
        claimed.add(inflow.id); claimed.add(out.id);
        paired += 1; ccPayments += 1;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 3: generic asset↔asset transfers (or any cross-account move that
  // Pass 1 and Pass 2 missed). Every account in Astroledger belongs to the user,
  // so any opposite-sign same-amount pair on different accounts within ±N
  // days is a transfer candidate. The safety lever is "exactly one match" - 
  // if multiple potential pairings exist we abstain (count as ambiguous)
  // rather than guess. This protects against coincidences like an unrelated
  // $50 payment + $50 deposit landing on the same day.
  // ────────────────────────────────────────────────────────────────────────
  const allUnpairedOutflows = await prisma.transaction.findMany({
    where: { transferGroupId: null, pairingDismissed: false, amount: { lt: 0 } },
    select: { id: true, accountId: true, date: true, amount: true, rawDescription: true },
    orderBy: { date: 'asc' },
  });
  if (allUnpairedOutflows.length > 0) {
    // Pull every unpaired inflow in a wide window matching any outflow's date.
    const oldest = new Date(Math.min(...allUnpairedOutflows.map(t => +t.date)));
    const newest = new Date(Math.max(...allUnpairedOutflows.map(t => +t.date)));
    const since = new Date(+oldest - rangeDays * 86400000);
    const until = new Date(+newest + rangeDays * 86400000);
    const allUnpairedInflows = await prisma.transaction.findMany({
      where: {
        transferGroupId: null, pairingDismissed: false, amount: { gt: 0 },
        date: { gte: since, lte: until },
      },
      select: { id: true, accountId: true, date: true, amount: true, rawDescription: true },
    });
    const inByAmount = new Map<number, typeof allUnpairedInflows>();
    for (const t of allUnpairedInflows) {
      const k = Math.round(Math.abs(t.amount) * 100);
      if (!inByAmount.has(k)) inByAmount.set(k, []);
      inByAmount.get(k)!.push(t);
    }
    // For mask-hint disambiguation: account.id → account.mask (or extracted from name)
    const maskByAcct = new Map(accountsMeta.map(a => [a.id, a.mask ?? null]));

    for (const out of allUnpairedOutflows) {
      if (claimed.has(out.id)) continue;
      const k = Math.round(Math.abs(out.amount) * 100);
      let candidates3 = (inByAmount.get(k) ?? []).filter(c =>
        !claimed.has(c.id)
        && c.accountId !== out.accountId
        && Math.abs((+c.date - +out.date) / 86400000) <= rangeDays
      );
      if (candidates3.length === 0) continue;
      if (candidates3.length > 1) {
        // Disambiguate using account-mask hints embedded in the descriptions.
        // The bank often writes the destination's account number into the
        // outflow's memo ("Twh Auto Transfer To 8060112588" → mask 2588).
        // Symmetrically, an inflow's memo may name the source ("From ...1011").
        const outHints = extractMaskHints(out.rawDescription);
        const hitFromOut = candidates3.filter(c => {
          const m = maskByAcct.get(c.accountId);
          return m && outHints.includes(m);
        });
        if (hitFromOut.length === 1) {
          candidates3 = hitFromOut;
        } else {
          // Try the other direction: which candidate's description names this outflow's account?
          const outMask = maskByAcct.get(out.accountId);
          const hitFromIn = outMask ? candidates3.filter(c => extractMaskHints(c.rawDescription).includes(outMask)) : [];
          if (hitFromIn.length === 1) {
            candidates3 = hitFromIn;
          } else {
            ambiguous++; continue;
          }
        }
      }
      // ALSO require this outflow be unique among candidates: another outflow
      // of the same amount within window pointing at the same inflow would
      // make the pairing ambiguous from the other side too. Re-check.
      const inflow = candidates3[0];
      const reverseCandidates = allUnpairedOutflows.filter(o =>
        !claimed.has(o.id)
        && o.id !== out.id
        && o.accountId !== inflow.accountId
        && Math.round(Math.abs(o.amount) * 100) === k
        && Math.abs((+o.date - +inflow.date) / 86400000) <= rangeDays
      );
      if (reverseCandidates.length > 0) { ambiguous++; continue; }

      const groupId = randomUUID();
      await prisma.transaction.updateMany({
        where: { id: { in: [out.id, inflow.id] } },
        data: { transferGroupId: groupId, isTransfer: true },
      });
      await attachTransferTag([out.id, inflow.id]);
      claimed.add(out.id); claimed.add(inflow.id);
      paired += 1;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 4: single-leg mention-based transfer detection.
  //
  // For unpaired outflows whose description mentions the mask of ANOTHER
  // Astroledger account, flag the outflow as isTransfer=true (no transferGroupId
  // since there's no counterpart row to link). Catches the "Loan X0000 XX0199"
  // case where the destination account has no transaction data - it's a
  // balance-only liability the user pays into. Excluding these from spending
  // totals matters more than visualizing the flow.
  //
  // Safety: require EXACTLY ONE matching mask to avoid ambiguity. Skip if
  // the outflow's own account is the only candidate.
  // ────────────────────────────────────────────────────────────────────────
  const allUnpairedNow = await prisma.transaction.findMany({
    where: { transferGroupId: null, isTransfer: false, pairingDismissed: false, amount: { lt: 0 } },
    select: { id: true, accountId: true, rawDescription: true },
  });
  // Build mask → accountId(s) lookup; ignore null masks
  const maskToAccts = new Map<string, string[]>();
  for (const a of accountsMeta) {
    if (!a.mask) continue;
    if (!maskToAccts.has(a.mask)) maskToAccts.set(a.mask, []);
    maskToAccts.get(a.mask)!.push(a.id);
  }
  for (const out of allUnpairedNow) {
    const hints = extractMaskHints(out.rawDescription);
    if (hints.length === 0) continue;
    // Find any hint whose mask maps to a Astroledger account that ISN'T this row's account.
    const otherAccts = new Set<string>();
    for (const h of hints) {
      for (const id of maskToAccts.get(h) ?? []) {
        if (id !== out.accountId) otherAccts.add(id);
      }
    }
    if (otherAccts.size !== 1) continue; // exactly one match required
    await prisma.transaction.update({
      where: { id: out.id },
      data: { isTransfer: true },
    });
    await attachTransferTag([out.id]);
    oneSidedFlagged++;
  }

  return { paired, alreadyPaired, ambiguous, ccPayments, oneSidedFlagged, rangeDays };
}
