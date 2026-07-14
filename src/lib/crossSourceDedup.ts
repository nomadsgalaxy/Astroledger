// Cross-source de-duplication.
//
// When the same real-world charge gets brought in by MORE THAN ONE source - 
// SimpleFIN + QIF, Plaid + CSV, PDF + CSV, etc. - the rows often have
// different descriptions so the import-time hash dedup misses them:
//   - SimpleFIN: "+7738.90 · ONLINE PAYMENT, THANK YOU"
//   - QIF:       "+7738.90 · Citi Bank"
//
// Two-stage discriminator:
//
// 1. Bucket every transaction by (accountId, UTC day, amountCents). Buckets
//    with only one row → no dupe possible.
//
// 2. Within a bucket, distinguish live-connector rows (Plaid / SimpleFIN /
//    PayPal - they always set `plaidTxId` to their stable provider id) from
//    file-import rows (CSV / QIF / OFX / QFX / PDF / manual - `plaidTxId` is
//    null). If a bucket contains BOTH kinds, the live-connector row is the
//    source of truth and the file rows are duplicates of the same charge - 
//    drop them. If a bucket is all live or all file, we leave it alone:
//    those are legitimate same-day same-amount transactions (e.g. two
//    coffees) that the user actually made.
//
// We deliberately do NOT use institution.source as the discriminator:
// after the QIF importer's mask-merge logic, a QIF-imported row may end
// up on an account owned by SimpleFIN - so institution.source no longer
// reflects the originating import path. plaidTxId is the durable signal.

import { prisma } from './prisma';

// When the bucket has multiple live rows or multiple file rows, prefer the
// most authoritative source (kept as a secondary tiebreaker).
const SOURCE_PRIORITY: Record<string, number> = {
  plaid:     100,   // live bank API, FITID-stable
  simplefin: 90,    // live aggregator
  paypal:    80,    // live REST API
  csv:       60,    // direct bank export
  qfx:       50,    // signed Quicken Financial Exchange
  ofx:       50,    // Open Financial Exchange
  qif:       40,    // Quicken Interchange (legacy text)
  pdf:       30,    // LLM-extracted from statement scan
  manual:    20,    // user-entered
  probe:     0,     // throwaway probe data
};
function authorityOf(source: string | null | undefined): number {
  if (!source) return 10;
  return SOURCE_PRIORITY[source] ?? 25;
}

export type DedupResult = {
  duplicateGroups: number;       // # of pair groups collapsed
  rowsRemoved: number;
  receiptsPreserved: number;
  ambiguousSkipped: number;      // bucket had >1 live or >1 file row in the window - left alone
  preview: Array<{
    keptId: string; keptSource: string; keptDesc: string; keptDate: string;
    droppedIds: string[]; droppedSources: string[]; droppedDescs: string[]; droppedDates: string[];
    account: string; amount: number;
  }>;
};

const DAY_MS = 86_400_000;

export async function dedupeCrossSource(opts: { dryRun?: boolean; dayWindow?: number; centTolerance?: number; allowCrossAccount?: boolean } = {}): Promise<DedupResult> {
  const dryRun = opts.dryRun === true;
  // Date window for "same charge, different post-date" cross-source matches.
  const windowDays = opts.dayWindow ?? 2;
  // Amount tolerance in cents - covers paycheck rounding ($817.10 vs $817.09).
  // Only applied when rows share a merchant; exact-cent matches always win.
  const centTolerance = opts.centTolerance ?? 1;
  // When true, also dedup cross-account pairs IF descriptions are byte-identical.
  // Targets cases where the same physical card got imported under two
  // different Astroledger account rows (live + file).
  const allowCrossAccount = opts.allowCrossAccount === true;

  const all = await prisma.transaction.findMany({
    select: {
      id: true, accountId: true, date: true, amount: true,
      rawDescription: true, plaidTxId: true,
      account: { select: { name: true, institution: { select: { source: true } } } },
    },
  });

  // Bucket by (accountId, amountCents) - IGNORING date. We then walk each
  // bucket and pair up live-vs-file rows whose dates fall within ±windowDays.
  const buckets = new Map<string, typeof all>();
  for (const t of all) {
    const cents = Math.round(t.amount * 100);
    const k = `${t.accountId}|${cents}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }

  const preview: DedupResult['preview'] = [];
  let rowsRemoved = 0;
  let receiptsPreserved = 0;
  let ambiguousSkipped = 0;
  const consumed = new Set<string>();   // ids already paired up - don't reuse

  for (const [, rows] of buckets) {
    if (rows.length < 2) continue;
    // Sort by date so we can scan forward / backward by window
    rows.sort((a, b) => +a.date - +b.date);
    const liveRows = rows.filter(r => !!r.plaidTxId);
    const fileRows = rows.filter(r =>  !r.plaidTxId);
    if (liveRows.length === 0 || fileRows.length === 0) continue;

    // For each live row, find file rows within ±windowDays.
    for (const live of liveRows) {
      if (consumed.has(live.id)) continue;
      const lowerBound = +live.date - windowDays * DAY_MS;
      const upperBound = +live.date + windowDays * DAY_MS;
      const fileInWindow = fileRows.filter(f =>
        !consumed.has(f.id) && +f.date >= lowerBound && +f.date <= upperBound
      );
      if (fileInWindow.length === 0) continue;
      // Safety: if another LIVE row is also in this file row's window, the
      // pairing is ambiguous - multiple live charges could claim the same
      // file copy. Skip rather than guess.
      const liveInWindow = liveRows.filter(l =>
        l.id !== live.id
        && !consumed.has(l.id)
        && fileInWindow.some(f => Math.abs(+l.date - +f.date) <= windowDays * DAY_MS)
      );
      if (liveInWindow.length > 0) { ambiguousSkipped++; continue; }
      // Also: if more than one FILE row is in the window, ambiguous too
      // (could be two distinct file imports of the same amount on different days,
      // both legitimately matching). Skip.
      if (fileInWindow.length > 1) { ambiguousSkipped++; continue; }

      const fileMatch = fileInWindow[0];
      preview.push({
        keptId: live.id,
        keptSource: live.account.institution.source,
        keptDesc: live.rawDescription,
        keptDate: live.date.toISOString().slice(0, 10),
        droppedIds: [fileMatch.id],
        droppedSources: [fileMatch.account.institution.source],
        droppedDescs: [fileMatch.rawDescription],
        droppedDates: [fileMatch.date.toISOString().slice(0, 10)],
        account: live.account.name,
        amount: live.amount,
      });
      consumed.add(live.id); consumed.add(fileMatch.id);

      if (!dryRun) {
        // Move receipts onto the kept row.
        const receipts = await prisma.receipt.findMany({ where: { transactionId: fileMatch.id }, select: { id: true } });
        if (receipts.length > 0) {
          await prisma.receipt.updateMany({
            where: { id: { in: receipts.map(r => r.id) } },
            data: { transactionId: live.id },
          });
          receiptsPreserved += receipts.length;
        }
        // Move tags (deduped via connect).
        const dupFull = await prisma.transaction.findUnique({
          where: { id: fileMatch.id },
          select: { tags: { select: { id: true } } },
        });
        if (dupFull && dupFull.tags.length > 0) {
          await prisma.transaction.update({
            where: { id: live.id },
            data: { tags: { connect: dupFull.tags } },
          });
        }
        await prisma.transaction.delete({ where: { id: fileMatch.id } });
        rowsRemoved++;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 1.5: same-account, same-day, amounts within ±centTolerance,
  // descriptions share ≥2 significant words.
  //
  // Banks/aggregators occasionally publish a payroll deposit with one-cent
  // rounding drift AND completely different descriptions from each source:
  //   - SimpleFIN: "Salary/Regular Income from Printed Solid"  +$817.10
  //   - QIF:       "Credit ...XYZ Printed Solid Payroll ..."   +$817.09
  // Exact-cent + exact-description misses this. The pair is overwhelmingly
  // the same charge when: same account + same day + amount within ±$0.01 +
  // descriptions share ≥2 significant tokens AND the live/file plaidTxId
  // pattern matches. The shared-token check avoids pairing unrelated charges
  // that just happen to be $1.00 apart with the same source/day.
  // ────────────────────────────────────────────────────────────────────────
  function significantTokens(s: string | null | undefined): Set<string> {
    if (!s) return new Set();
    const COMMON = new Set([
      'the','and','for','from','with','this','that','your','will','have','has',
      'are','was','were','been','been','being','some','more','less','here','there',
      'card','debit','credit','online','transfer','payment','purchase','transaction','recur','recurring',
      'pmt','xfer','dba','llc','inc','corp','co',
    ]);
    return new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 4 && !COMMON.has(t) && !/^\d+$/.test(t))
    );
  }
  function sharedTokens(a: string | null, b: string | null): number {
    const sa = significantTokens(a); const sb = significantTokens(b);
    let n = 0; for (const t of sa) if (sb.has(t)) n++;
    return n;
  }

  if (centTolerance > 0) {
    // Bucket by (accountId, day) so we can pair within each day on a single account
    const dayBuckets = new Map<string, typeof all>();
    for (const t of all) {
      if (consumed.has(t.id)) continue;
      const k = `${t.accountId}|${t.date.toISOString().slice(0, 10)}`;
      if (!dayBuckets.has(k)) dayBuckets.set(k, []);
      dayBuckets.get(k)!.push(t);
    }
    for (const [, rows] of dayBuckets) {
      if (rows.length < 2) continue;
      const live = rows.filter(r => !!r.plaidTxId);
      const file = rows.filter(r =>  !r.plaidTxId);
      if (live.length === 0 || file.length === 0) continue;
      for (const liveRow of live) {
        if (consumed.has(liveRow.id)) continue;
        const liveCents = Math.round(liveRow.amount * 100);
        // Pick the file row with ≥2 shared significant tokens AND cents within tolerance
        const fileMatch = file.find(f =>
          !consumed.has(f.id)
          && Math.abs(Math.round(f.amount * 100) - liveCents) <= centTolerance
          && sharedTokens(liveRow.rawDescription, f.rawDescription) >= 2
        );
        if (!fileMatch) continue;
        preview.push({
          keptId: liveRow.id,
          keptSource: liveRow.account.institution.source,
          keptDesc: liveRow.rawDescription,
          keptDate: liveRow.date.toISOString().slice(0, 10),
          droppedIds: [fileMatch.id],
          droppedSources: [fileMatch.account.institution.source],
          droppedDescs: [fileMatch.rawDescription],
          droppedDates: [fileMatch.date.toISOString().slice(0, 10)],
          account: liveRow.account.name,
          amount: liveRow.amount,
        });
        consumed.add(liveRow.id); consumed.add(fileMatch.id);
        if (!dryRun) {
          const receipts = await prisma.receipt.findMany({ where: { transactionId: fileMatch.id }, select: { id: true } });
          if (receipts.length > 0) {
            await prisma.receipt.updateMany({ where: { id: { in: receipts.map(r => r.id) } }, data: { transactionId: liveRow.id } });
            receiptsPreserved += receipts.length;
          }
          await prisma.transaction.delete({ where: { id: fileMatch.id } });
          rowsRemoved++;
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 2: targeted same-account duplicate cleanup from ambiguous transfer
  // candidates.
  //
  // The matcher's "ambiguous" list is the safest source for Pass 2. When an
  // outflow has 2+ candidate inflows of the same amount within ±rangeDays AND
  // those candidates live on the SAME account, they're internally duplicating
  // each other (probably post-date drift after an account merge). Collapse
  // them - keep the row that has a plaidTxId if any, else the newer createdAt.
  //
  // We deliberately do NOT do this for candidates on different accounts - 
  // those are genuine ambiguity that needs human review (the destination
  // account could legitimately be either). And we skip any row already
  // attached to a confirmed transfer pair.
  // ────────────────────────────────────────────────────────────────────────
  const { findAmbiguousTransfers } = await import('./transferReview');
  const ambiguous = await findAmbiguousTransfers({ rangeDays: windowDays });
  for (const group of ambiguous) {
    // Bucket candidate inflows by accountId
    const byAcct = new Map<string, typeof group.candidates>();
    for (const c of group.candidates) {
      if (consumed.has(c.id)) continue;
      if (!byAcct.has(c.accountId)) byAcct.set(c.accountId, []);
      byAcct.get(c.accountId)!.push(c);
    }
    for (const [, sameAcctCands] of byAcct) {
      if (sameAcctCands.length < 2) continue; // need ≥2 on the same account to be a dupe
      // Need full row data (plaidTxId, createdAt) for the keep/drop decision
      const ids = sameAcctCands.map(c => c.id);
      const full = await prisma.transaction.findMany({
        where: { id: { in: ids }, transferGroupId: null },
        select: { id: true, plaidTxId: true, createdAt: true, account: { select: { name: true } }, rawDescription: true, amount: true, date: true },
      });
      if (full.length < 2) continue;
      // Sort: plaidTxId-bearing first, then newest createdAt
      full.sort((a, b) => {
        const aLive = a.plaidTxId ? 1 : 0;
        const bLive = b.plaidTxId ? 1 : 0;
        if (aLive !== bLive) return bLive - aLive;
        return +b.createdAt - +a.createdAt;
      });
      const keep = full[0];
      const drops = full.slice(1);

      preview.push({
        keptId: keep.id,
        keptSource: keep.plaidTxId ? 'live' : 'file',
        keptDesc: keep.rawDescription,
        keptDate: keep.date.toISOString().slice(0, 10),
        droppedIds: drops.map(d => d.id),
        droppedSources: drops.map(d => d.plaidTxId ? 'live' : 'file'),
        droppedDescs: drops.map(d => d.rawDescription),
        droppedDates: drops.map(d => d.date.toISOString().slice(0, 10)),
        account: keep.account.name,
        amount: keep.amount,
      });
      consumed.add(keep.id);
      drops.forEach(d => consumed.add(d.id));

      if (!dryRun) {
        for (const dup of drops) {
          const receipts = await prisma.receipt.findMany({ where: { transactionId: dup.id }, select: { id: true } });
          if (receipts.length > 0) {
            await prisma.receipt.updateMany({
              where: { id: { in: receipts.map(r => r.id) } },
              data: { transactionId: keep.id },
            });
            receiptsPreserved += receipts.length;
          }
          const dupFull = await prisma.transaction.findUnique({
            where: { id: dup.id },
            select: { tags: { select: { id: true } } },
          });
          if (dupFull && dupFull.tags.length > 0) {
            await prisma.transaction.update({
              where: { id: keep.id },
              data: { tags: { connect: dupFull.tags } },
            });
          }
          await prisma.transaction.delete({ where: { id: dup.id } });
          rowsRemoved++;
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pass 3: cross-ACCOUNT identical-description dedup (opt-in via allowCrossAccount).
  // For cases where the same physical card landed under two Astroledger account
  // rows (QIF named it one thing, SimpleFIN named it another). Safety: require
  // byte-identical raw descriptions AND a live↔file plaidTxId mismatch - both
  // signals together are essentially unforgeable for distinct purchases.
  // ────────────────────────────────────────────────────────────────────────
  if (allowCrossAccount) {
    // Bucket by (amountCents, day, rawDescription) - note: NOT account-scoped.
    const xBuckets = new Map<string, typeof all>();
    for (const t of all) {
      if (consumed.has(t.id)) continue;
      const day = t.date.toISOString().slice(0, 10);
      const cents = Math.round(t.amount * 100);
      const desc = (t.rawDescription ?? '').trim();
      if (!desc) continue;                        // refuse to match empty/missing descriptions
      const k = `${cents}|${day}|${desc}`;
      if (!xBuckets.has(k)) xBuckets.set(k, []);
      xBuckets.get(k)!.push(t);
    }
    for (const [, rows] of xBuckets) {
      if (rows.length < 2) continue;
      const live = rows.filter(r => !!r.plaidTxId);
      const file = rows.filter(r =>  !r.plaidTxId);
      if (live.length === 0 || file.length === 0) continue;
      live.sort((a, b) => authorityOf(b.account.institution.source) - authorityOf(a.account.institution.source));
      const keep = live[0];
      const drops = [...live.slice(1), ...file].filter(d => !consumed.has(d.id));
      if (drops.length === 0) continue;
      preview.push({
        keptId: keep.id,
        keptSource: keep.account.institution.source,
        keptDesc: keep.rawDescription,
        keptDate: keep.date.toISOString().slice(0, 10),
        droppedIds: drops.map(d => d.id),
        droppedSources: drops.map(d => d.account.institution.source),
        droppedDescs: drops.map(d => d.rawDescription),
        droppedDates: drops.map(d => d.date.toISOString().slice(0, 10)),
        account: `${keep.account.name} ← ${drops.map(d => d.account.name).join(', ')}`,
        amount: keep.amount,
      });
      consumed.add(keep.id);
      drops.forEach(d => consumed.add(d.id));
      if (!dryRun) {
        for (const dup of drops) {
          const receipts = await prisma.receipt.findMany({ where: { transactionId: dup.id }, select: { id: true } });
          if (receipts.length > 0) {
            await prisma.receipt.updateMany({ where: { id: { in: receipts.map(r => r.id) } }, data: { transactionId: keep.id } });
            receiptsPreserved += receipts.length;
          }
          const dupFull = await prisma.transaction.findUnique({ where: { id: dup.id }, select: { tags: { select: { id: true } } } });
          if (dupFull && dupFull.tags.length > 0) {
            await prisma.transaction.update({ where: { id: keep.id }, data: { tags: { connect: dupFull.tags } } });
          }
          await prisma.transaction.delete({ where: { id: dup.id } });
          rowsRemoved++;
        }
      }
    }
  }

  // Touch the unused authority helper to silence linters when only windowed
  // pairing is exercised (it remains useful for future multi-live tiebreaks).
  void authorityOf;

  return { duplicateGroups: preview.length, rowsRemoved, receiptsPreserved, ambiguousSkipped, preview };
}
