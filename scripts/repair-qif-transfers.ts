// One-shot repair for QIF transactions mis-imported before the L[bracket]
// transfer-detection fix (task #220). The buggy parser stored the bracketed
// transfer target in `notes` as "Quicken category: [Account Name]" but left
// isTransfer=false and transferGroupId=null, so credit-card payments and
// inter-account moves were counted as income/spending (the phantom 5/15
// income spike).
//
// This repairs IN PLACE — no re-import — by parsing the bracket back out of
// notes, setting isTransfer=true, and assigning the SAME deterministic
// transferGroupId the fixed parser now computes (unordered account-pair +
// date + abs(amount)), so both legs pair.
//
// Idempotent: re-running only touches rows still showing the buggy pattern.
// Scoped to source='qif' rows only — SimpleFIN/Plaid rows are never touched.
//
// Usage: npx tsx scripts/repair-qif-transfers.ts [--apply]
//   (dry-run by default; --apply commits)

import { prisma } from '../src/lib/prisma';
import { txnHash } from '../src/lib/hash';

const APPLY = process.argv.includes('--apply');

const NOTE_BRACKET = /^Quicken category:\s*\[([^\]]+)\]/;

async function main() {
  // QIF institution(s)
  const qifInsts = await prisma.institution.findMany({ where: { source: 'qif' }, select: { id: true } });
  const qifInstIds = qifInsts.map(i => i.id);
  if (qifInstIds.length === 0) { console.log('No QIF institution found — nothing to repair.'); return; }

  const qifAccounts = await prisma.bankAccount.findMany({
    where: { institutionId: { in: qifInstIds } },
    select: { id: true, name: true },
  });
  const acctNameById = new Map(qifAccounts.map(a => [a.id, a.name]));
  const qifAccountIds = qifAccounts.map(a => a.id);

  // Candidate rows: QIF-sourced, not yet flagged as transfer, whose notes
  // carry the bracketed-transfer signature.
  const candidates = await prisma.transaction.findMany({
    where: {
      accountId: { in: qifAccountIds },
      isTransfer: false,
      notes: { startsWith: 'Quicken category: [' },
    },
    select: { id: true, accountId: true, date: true, amount: true, notes: true },
  });

  console.log(`Found ${candidates.length} QIF rows with a bracketed-transfer note still flagged non-transfer.`);

  let repaired = 0;
  let inflowReclassified = 0;
  let inflowAmount = 0;
  const ops: Array<ReturnType<typeof prisma.transaction.update>> = [];

  for (const t of candidates) {
    const m = (t.notes ?? '').match(NOTE_BRACKET);
    if (!m) continue;
    const counterName = m[1].trim();
    const thisName = acctNameById.get(t.accountId) ?? t.accountId;
    const pair = [thisName, counterName].sort().join('|');
    const transferGroupId = 'qif:' + txnHash({
      accountId: pair, date: t.date, amount: Math.abs(t.amount), rawDescription: 'xfer',
    });
    if (t.amount > 0) { inflowReclassified++; inflowAmount += t.amount; }
    repaired++;
    ops.push(prisma.transaction.update({
      where: { id: t.id },
      data: { isTransfer: true, transferGroupId, notes: `Quicken transfer: [${counterName}]` },
    }));
  }

  console.log(`Will reclassify ${repaired} rows as transfers.`);
  console.log(`  Of those, ${inflowReclassified} were positive (income-inflating) totaling $${inflowAmount.toFixed(2)}.`);

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to commit.');
    await prisma.$disconnect();
    return;
  }

  // Apply in chunks of 100.
  for (let i = 0; i < ops.length; i += 100) {
    await prisma.$transaction(ops.slice(i, i + 100));
  }
  console.log(`\nApplied. ${repaired} rows reclassified as transfers.`);

  // Post-repair verification: non-transfer positive inflow on credit accounts.
  const after = await prisma.$queryRawUnsafe<Array<{ total: number; n: number }>>(`
    SELECT ROUND(SUM(t.amount),2) total, COUNT(*) n
    FROM "Transaction" t JOIN "BankAccount" b ON b.id=t.accountId
    WHERE t.amount>0 AND t.isTransfer=0 AND b.type='credit'`);
  console.log(`Remaining positive non-transfer credit-account inflow: $${after[0]?.total ?? 0} across ${after[0]?.n ?? 0} rows (these should be genuine refunds/credits).`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
