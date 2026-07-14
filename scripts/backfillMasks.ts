// Backfill BankAccount.mask for rows where it's null but the name contains
// a 4-digit mask (e.g. "Spend (1011)"). Lets the new merge-by-mask logic
// catch SimpleFIN ↔ QIF duplicates without forcing the user to do anything.
import { prisma } from '../src/lib/prisma';
import { extractMask } from '../src/lib/accountMerge';

async function main() {
  const candidates = await prisma.bankAccount.findMany({
    where: { mask: null },
    select: { id: true, name: true },
  });
  let updated = 0;
  for (const a of candidates) {
    const m = extractMask(a.name);
    if (m) {
      await prisma.bankAccount.update({ where: { id: a.id }, data: { mask: m } });
      updated++;
      console.log(`  ${a.id.slice(-6)}  ${a.name.padEnd(40)} → mask=${m}`);
    }
  }
  console.log(`\nBackfilled ${updated} of ${candidates.length} candidates.`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
