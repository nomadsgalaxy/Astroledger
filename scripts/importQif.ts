// One-shot CLI import: tsx scripts/importQif.ts <path> [fallbackAccountName]
// Bypasses the HTTP layer (no auth, no dev-server dependency).
import { readFileSync } from 'node:fs';
import { importQuicken } from '../src/lib/quickenImport';
import { prisma } from '../src/lib/prisma';

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: tsx scripts/importQif.ts <path> [fallbackAccountName]'); process.exit(1); }
  const fallback = process.argv[3] ?? 'Quicken Import';
  console.log(`Reading ${file}...`);
  const text = readFileSync(file, 'utf8');
  console.log(`Loaded ${text.length} chars. Importing...`);
  const t0 = Date.now();
  const r = await importQuicken(text, fallback);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== IMPORT RESULT ===');
  console.log(JSON.stringify(r, null, 2));
  console.log(`Took ${dt}s\n`);

  // Sanity summary
  const totalTx = await prisma.transaction.count();
  const totalTag = await prisma.tag.count();
  const totalCat = await prisma.category.count();
  const totalAcc = await prisma.bankAccount.count();
  console.log(`DB now has: ${totalTx} txns, ${totalTag} tags, ${totalCat} cats, ${totalAcc} accounts.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
