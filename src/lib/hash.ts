import { createHash } from 'node:crypto';

export function txnHash(parts: {
  accountId: string;
  date: Date | string;
  amount: number;
  rawDescription: string;
}): string {
  const d = typeof parts.date === 'string' ? parts.date : parts.date.toISOString().slice(0, 10);
  const k = `${parts.accountId}|${d}|${parts.amount.toFixed(2)}|${parts.rawDescription.trim().toLowerCase()}`;
  return createHash('sha1').update(k).digest('hex');
}
