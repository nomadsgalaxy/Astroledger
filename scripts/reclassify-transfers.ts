// Backfill: reclassify mis-recorded transfers/CC-payments that were stored as
// isTransfer=false positive inflows (inflating income + the forecast). Uses the
// shared classifier (lib/transferClassify) so existing-data repair and
// future-ingest prevention share one source of truth.
//
// DRY RUN by default — prints the full candidate list grouped by reason for
// review. --apply commits. --aggressive enables the broader signal tier.
//
// Idempotent: only touches rows currently isTransfer=false.
//
// Usage:
//   npx tsx scripts/reclassify-transfers.ts                 # dry run, conservative
//   npx tsx scripts/reclassify-transfers.ts --aggressive    # dry run, aggressive
//   npx tsx scripts/reclassify-transfers.ts --aggressive --apply

import { prisma } from '../src/lib/prisma';
import { resolvedKind } from '../src/lib/accountKind';
import { classifyTransfer } from '../src/lib/transferClassify';

const APPLY = process.argv.includes('--apply');
const AGGRESSIVE = process.argv.includes('--aggressive');

async function main() {
  // Only positive inflows that aren't already transfers/splits are candidates.
  // (A negative row mis-flagged is a different, rarer case; income inflation is
  // the reported bug, so we scope to positives.)
  const rows = await prisma.transaction.findMany({
    where: { amount: { gt: 0 }, isTransfer: false, isSplit: false },
    select: {
      id: true, merchant: true, rawDescription: true, amount: true, date: true,
      account: { select: { name: true, kind: true, type: true } },
    },
    orderBy: { amount: 'desc' },
  });

  const hits: Array<{ id: string; merchant: string; amount: number; reason: string; acct: string }> = [];
  for (const r of rows) {
    const kind = resolvedKind({ kind: r.account.kind, type: r.account.type });
    const v = classifyTransfer(
      { merchant: r.merchant, rawDescription: r.rawDescription, amount: r.amount, accountKind: kind },
      { aggressive: AGGRESSIVE },
    );
    if (v.isTransfer) {
      hits.push({ id: r.id, merchant: (r.merchant ?? r.rawDescription ?? '').slice(0, 42), amount: r.amount, reason: v.reason, acct: r.account.name });
    }
  }

  // Group by reason for the review list.
  const byReason = new Map<string, { n: number; total: number; samples: string[] }>();
  for (const h of hits) {
    const g = byReason.get(h.reason) ?? { n: 0, total: 0, samples: [] };
    g.n++; g.total += h.amount;
    if (g.samples.length < 6) g.samples.push(`$${h.amount.toFixed(0)} ${h.merchant} [${h.acct}]`);
    byReason.set(h.reason, g);
  }

  console.log(`\n=== Reclassification candidates (${AGGRESSIVE ? 'AGGRESSIVE' : 'conservative'}) ===`);
  let grandTotal = 0;
  for (const [reason, g] of [...byReason.entries()].sort((a, b) => b[1].total - a[1].total)) {
    grandTotal += g.total;
    console.log(`\n[${reason}]  ${g.n} rows  $${g.total.toFixed(2)}`);
    for (const s of g.samples) console.log('    ' + s);
    if (g.n > g.samples.length) console.log(`    … +${g.n - g.samples.length} more`);
  }
  console.log(`\nTOTAL: ${hits.length} rows, $${grandTotal.toFixed(2)} would move from income → transfer.`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    await prisma.$disconnect();
    return;
  }

  // Apply: set isTransfer=true. We deliberately do NOT assign a transferGroupId
  // here (these are one-sided — no reliable counter-leg); pairCrossAccountTransfers
  // can still group them later if a match exists. Flagging isTransfer alone is
  // enough to exclude them from income/spending rollups + the forecast.
  let done = 0;
  for (let i = 0; i < hits.length; i += 100) {
    const chunk = hits.slice(i, i + 100);
    await prisma.$transaction(chunk.map(h =>
      prisma.transaction.update({ where: { id: h.id }, data: { isTransfer: true } })));
    done += chunk.length;
  }
  console.log(`\nApplied: ${done} rows reclassified as transfers.`);

  const after = await prisma.$queryRawUnsafe<Array<{ total: number; n: number }>>(`
    SELECT ROUND(SUM(amount),2) total, COUNT(*) n FROM "Transaction" WHERE amount>0 AND isTransfer=0 AND isSplit=0`);
  console.log(`Remaining positive non-transfer inflow (income): $${after[0]?.total ?? 0} across ${after[0]?.n ?? 0} rows.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
