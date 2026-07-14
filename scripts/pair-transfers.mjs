#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const RANGE_DAYS = parseInt(process.argv[2] ?? '2', 10);
const TRANSFER_HINTS = /\b(transfer|xfer|wallet|to\s+(spend|growth|reserve)|from\s+(spend|growth|reserve)|inst\s*xfer|internal\s+transfer|account\s+transfer)\b/i;
const p = new PrismaClient();

const candidates = await p.transaction.findMany({
  where: {
    transferGroupId: null,
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

const byAmount = new Map();
for (const t of candidates) {
  const k = Math.round(Math.abs(t.amount) * 100);
  if (!byAmount.has(k)) byAmount.set(k, []);
  byAmount.get(k).push(t);
}

let paired = 0, ambiguous = 0;
const claimed = new Set();
const examples = [];

for (const out of candidates) {
  if (out.amount >= 0) continue;
  if (claimed.has(out.id)) continue;
  const k = Math.round(Math.abs(out.amount) * 100);
  const sameAmount = byAmount.get(k) ?? [];
  const matches = sameAmount.filter(c =>
    c.amount > 0
    && c.accountId !== out.accountId
    && !claimed.has(c.id)
    && Math.abs((+c.date - +out.date) / 86400000) <= RANGE_DAYS);
  if (matches.length === 0) continue;
  const hasHint = TRANSFER_HINTS.test(out.rawDescription ?? '')
    || TRANSFER_HINTS.test(out.merchant ?? '')
    || matches.some(m => TRANSFER_HINTS.test(m.rawDescription ?? '') || TRANSFER_HINTS.test(m.merchant ?? ''));
  if (!hasHint) continue;
  if (matches.length > 1) { ambiguous++; continue; }
  const inflow = matches[0];
  const groupId = crypto.randomUUID();
  await p.transaction.updateMany({
    where: { id: { in: [out.id, inflow.id] } },
    data: { transferGroupId: groupId, isTransfer: true },
  });
  claimed.add(out.id); claimed.add(inflow.id);
  paired++;
  if (examples.length < 5) examples.push({
    out: { date: out.date.toISOString().slice(0,10), amount: out.amount, desc: out.rawDescription?.slice(0, 60) },
    in:  { date: inflow.date.toISOString().slice(0,10), amount: inflow.amount, desc: inflow.rawDescription?.slice(0, 60) },
  });
}

console.log(`Paired ${paired} cross-account transfers (±${RANGE_DAYS} days). Ambiguous (skipped): ${ambiguous}.`);
if (examples.length > 0) {
  console.log('\nExamples:');
  for (const e of examples) {
    console.log(`  ${e.out.date} $${e.out.amount.toFixed(2)} ${e.out.desc}`);
    console.log(`  ${e.in.date}  +$${e.in.amount.toFixed(2)} ${e.in.desc}`);
    console.log('');
  }
}
await p.$disconnect();
