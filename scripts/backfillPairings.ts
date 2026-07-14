// One-shot: run pair-transfers across the entire DB so existing CC payments
// and inter-account moves get retroactively flagged as transfers (no income
// double-counting). Idempotent — safe to re-run.
//
// Workaround: transferPairing.ts imports 'server-only', which only resolves
// inside Next.js. Dynamic-import the module by file path so we can run via tsx.
import { prisma } from '../src/lib/prisma';

// Monkey-patch the 'server-only' resolution before loading transferPairing.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// @ts-ignore — stub the module that doesn't exist in standalone scripts
require.cache[require.resolve.paths('server-only')?.[0] ? 'server-only' : 'server-only'] = { exports: {} } as any;

async function main() {
  // Lazy load AFTER the stub above
  const { pairCrossAccountTransfers } = await import('../src/lib/transferPairing');
  const r = await pairCrossAccountTransfers({ rangeDays: 3 });
  console.log('Pairing result:', JSON.stringify(r, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
