import { prisma } from '@/lib/prisma';
import DashboardClient from '../_components/DashboardClient';
import { getRange } from '@/lib/timeRange.server';

export const dynamic = 'force-dynamic';

async function loadDashboard() {
  const range = await getRange();
  const now = range.until;
  const sinceCur = range.since;
  const sincePrev = new Date(+sinceCur - range.days * 86400000);

  // Cash across accounts (point-in-time - independent of range)
  const accounts = await prisma.bankAccount.findMany({ include: { institution: true } });
  const cash = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  // Pull all tx covering current + prior window (for trend + delta)
  const txAll = await prisma.transaction.findMany({
    where: { date: { gte: sincePrev }, isTransfer: false },
    select: { date: true, amount: true, merchant: true, rawDescription: true, category: { select: { name: true, color: true } } },
  });

  const windowTx = txAll.filter(t => t.date >= sinceCur);
  const priorTx  = txAll.filter(t => t.date >= sincePrev && t.date < sinceCur);

  const rangeIncome = windowTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const rangeSpend  = windowTx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0); // negative
  const prevSpend   = priorTx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  // Bucket the window for the trail chart:
  // ≤45 days: per-day; ≤120 days: per-week; otherwise: per-month
  type Bucket = { m: string; income: number; spend: number };
  const buckets = new Map<string, Bucket>();
  const bucketKey = (d: Date): string => {
    if (range.days <= 45) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    if (range.days <= 120) {
      // ISO week key (year + week #)
      const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((+tmp - +yearStart) / 86400000) + 1) / 7);
      return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  for (const t of windowTx) {
    const k = bucketKey(t.date);
    const cur = buckets.get(k) ?? { m: k, income: 0, spend: 0 };
    if (t.amount > 0) cur.income += t.amount; else cur.spend += Math.abs(t.amount);
    buckets.set(k, cur);
  }
  const trail = [...buckets.values()]
    .sort((a, b) => a.m.localeCompare(b.m))
    .map(v => ({
      m: range.days <= 45 ? v.m.slice(5)
        : range.days <= 120 ? v.m.slice(5)
        : v.m.slice(5),
      income: +v.income.toFixed(0),
      spend:  +v.spend.toFixed(0),
    }));

  // Heatmap: one cell per day across the range. Tracks BOTH spend and income
  // per day so the calendar can show net flow + click through to a filtered
  // transactions list.
  const dayBuckets = new Map<string, { spend: number; income: number }>();
  for (const t of windowTx) {
    const k = t.date.toISOString().slice(0, 10);
    const cur = dayBuckets.get(k) ?? { spend: 0, income: 0 };
    if (t.amount > 0) cur.income += t.amount;
    else              cur.spend += Math.abs(t.amount);
    dayBuckets.set(k, cur);
  }
  const days: Array<{ date: string; spend: number; income: number; net: number }> = [];
  for (let i = 0; i < range.days; i++) {
    const d = new Date(+sinceCur + i * 86400000);
    const k = d.toISOString().slice(0, 10);
    const b = dayBuckets.get(k) ?? { spend: 0, income: 0 };
    days.push({ date: d.toISOString(), spend: b.spend, income: b.income, net: b.income - b.spend });
  }

  // Recent activity in the window - capped at 8
  const lastTx = await prisma.transaction.findMany({
    where: { date: { gte: sinceCur } },
    orderBy: { date: 'desc' }, take: 8,
    include: { category: true, account: true },
  });

  // Subscriptions due in next 14 days (forward-looking; not range-scoped)
  const in14 = new Date(+now + 14 * 86400000);
  const upcomingSubs = await prisma.subscription.findMany({
    where: { status: 'active', nextEstimate: { gte: now, lte: in14 } },
    orderBy: { nextEstimate: 'asc' }, take: 4,
  });

  const subActive = await prisma.subscription.count({ where: { status: 'active' } });
  const recsCount = await prisma.recommendation.count({ where: { status: 'open' } });

  // "Saved" within the window = positive net flow, but never below zero
  const saved = Math.max(0, rangeIncome + rangeSpend);

  return {
    cash,
    range: { key: range.key, label: range.label, days: range.days },
    month: { income: rangeIncome, spend: rangeSpend, prevSpend, saved },
    trail,
    heatmap: days,
    lastTx: lastTx.map(t => ({
      id: t.id, date: t.date.toISOString(),
      merchant: t.merchant ?? 'Unknown',
      amount: t.amount, category: t.category?.name ?? 'Other',
      categoryColor: t.category?.color ?? null,
      account: t.account.name, accountMask: t.account.mask ?? '',
    })),
    upcomingSubs: upcomingSubs.map(s => ({
      id: s.id, merchant: s.merchant, amount: s.amount,
      next: s.nextEstimate?.toISOString() ?? null,
    })),
    stats: { subActive, recsCount, accountCount: accounts.length, monthLabel: range.label, txCount: windowTx.length },
  };
}

export default async function Home() {
  const data = await loadDashboard();
  return <DashboardClient data={data} />;
}
