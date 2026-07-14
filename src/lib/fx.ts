import { prisma } from './prisma';
import { BASE_CURRENCY } from './currencies';

// Re-export so server callers can keep importing from '@/lib/fx'.
export { BASE_CURRENCY, COMMON_CURRENCIES } from './currencies';

// Find the most recent rate at or before `date` for `quote`. Falls back to
// the closest-by-date rate (forward in time) if no earlier one exists. The
// rate stored is "1 USD = rate × quote", so converting `quote → USD` means
// dividing by rate.
export async function getRate(date: Date, quote: string): Promise<{ rate: number; fxDate: Date } | null> {
  if (quote === BASE_CURRENCY) return { rate: 1, fxDate: date };
  const at = await prisma.fxRate.findFirst({
    where: { quote, date: { lte: date } },
    orderBy: { date: 'desc' },
  });
  if (at) return { rate: at.rate, fxDate: at.date };
  const after = await prisma.fxRate.findFirst({
    where: { quote, date: { gt: date } },
    orderBy: { date: 'asc' },
  });
  return after ? { rate: after.rate, fxDate: after.date } : null;
}

// Convert `amount` in `currency` to base currency at the charge date.
// Returns null if no rate is known - caller can choose to leave baseAmount
// null (which signals "unknown" downstream) or surface a warning.
export async function toBase(amount: number, currency: string, date: Date): Promise<{
  base: number; rate: number; fxDate: Date;
} | null> {
  const r = await getRate(date, currency);
  if (!r) return null;
  // Stored convention: 1 USD = r.rate units of quote, so quote→USD divides.
  return { base: amount / r.rate, rate: r.rate, fxDate: r.fxDate };
}

// Backfill missing baseAmount values on existing transactions. Idempotent - 
// only touches rows where currency != USD AND baseAmount is null.
export async function backfillBaseAmounts(opts: { sinceDays?: number } = {}): Promise<{ updated: number; missing: number }> {
  const since = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86400000) : undefined;
  const txs = await prisma.transaction.findMany({
    where: {
      currency: { not: BASE_CURRENCY },
      baseAmount: null,
      ...(since ? { date: { gte: since } } : {}),
    },
    select: { id: true, amount: true, currency: true, date: true },
  });
  let updated = 0, missing = 0;
  for (const t of txs) {
    const r = await toBase(t.amount, t.currency, t.date);
    if (!r) { missing += 1; continue; }
    await prisma.transaction.update({ where: { id: t.id }, data: { baseAmount: r.base } });
    updated += 1;
  }
  return { updated, missing };
}

