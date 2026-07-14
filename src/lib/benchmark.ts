// Benchmark helpers: YoY, QoQ, rolling baseline, plan drift.
import { prisma } from './prisma';

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function yoyByCategory(monthsBack = 24) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - monthsBack);
  const txs = await prisma.transaction.findMany({
    where: { date: { gte: since }, amount: { lt: 0 }, isTransfer: false },
    include: { category: true },
  });
  type CatMonth = Map<string, Map<string, number>>; // category → ym → total
  const data: CatMonth = new Map();
  for (const t of txs) {
    const cat = t.category?.name ?? 'Other';
    const m = ym(t.date);
    if (!data.has(cat)) data.set(cat, new Map());
    const inner = data.get(cat)!;
    inner.set(m, (inner.get(m) ?? 0) + Math.abs(t.amount));
  }

  const now = new Date();
  const thisMo = ym(now);
  const lastYrMo = ym(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)));

  return [...data.entries()].map(([cat, months]) => {
    const cur = months.get(thisMo) ?? 0;
    const prev = months.get(lastYrMo) ?? 0;
    return {
      category: cat,
      current: cur, prior: prev,
      delta: cur - prev,
      pct: prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0),
    };
  }).filter(r => r.current > 0 || r.prior > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export async function qoqByCategory() {
  const txs = await prisma.transaction.findMany({
    where: { amount: { lt: 0 }, isTransfer: false },
    include: { category: true },
    take: 50000,
  });
  type Bucket = Map<string, Map<string, number>>;
  const data: Bucket = new Map();
  for (const t of txs) {
    const cat = t.category?.name ?? 'Other';
    const q = `${t.date.getUTCFullYear()}-Q${Math.floor(t.date.getUTCMonth() / 3) + 1}`;
    if (!data.has(cat)) data.set(cat, new Map());
    const inner = data.get(cat)!;
    inner.set(q, (inner.get(q) ?? 0) + Math.abs(t.amount));
  }
  const now = new Date();
  const curQ = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  const prevQDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const prevQ = `${prevQDate.getUTCFullYear()}-Q${Math.floor(prevQDate.getUTCMonth() / 3) + 1}`;
  const yearAgoQ = `${now.getUTCFullYear() - 1}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;

  return [...data.entries()].map(([cat, qs]) => ({
    category: cat,
    current: qs.get(curQ) ?? 0,
    priorQuarter: qs.get(prevQ) ?? 0,
    yearAgoQuarter: qs.get(yearAgoQ) ?? 0,
    quarters: { current: curQ, prev: prevQ, yearAgo: yearAgoQ },
  })).sort((a, b) => b.current - a.current);
}

/** Range-aware benchmark: current window vs prior equal-length window vs same window one year ago. */
export async function benchmarkByCategory(sinceCur: Date, until: Date) {
  const days = Math.max(1, Math.round((+until - +sinceCur) / 86400000));
  const sincePrev = new Date(+sinceCur - days * 86400000);
  const yoyStart  = new Date(+sinceCur - 365 * 86400000);
  const yoyEnd    = new Date(+until    - 365 * 86400000);

  const txs = await prisma.transaction.findMany({
    where: {
      isTransfer: false, amount: { lt: 0 },
      OR: [
        { date: { gte: sincePrev, lte: until } },
        { date: { gte: yoyStart,  lt: yoyEnd } },
      ],
    },
    include: { category: true },
  });

  type Row = { category: string; current: number; prior: number; yearAgo: number };
  const map = new Map<string, Row>();
  const ensure = (c: string): Row => {
    let r = map.get(c);
    if (!r) { r = { category: c, current: 0, prior: 0, yearAgo: 0 }; map.set(c, r); }
    return r;
  };
  for (const t of txs) {
    const cat = t.category?.name ?? 'Other';
    const amt = Math.abs(t.amount);
    if (t.date >= sinceCur && t.date <= until)  ensure(cat).current += amt;
    else if (t.date >= sincePrev && t.date < sinceCur) ensure(cat).prior += amt;
    else if (t.date >= yoyStart && t.date < yoyEnd)    ensure(cat).yearAgo += amt;
  }
  return [...map.values()]
    .filter(r => r.current > 0 || r.prior > 0 || r.yearAgo > 0)
    .sort((a, b) => b.current - a.current);
}

export async function rollingBaseline(category: string, windowMonths = 12) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - windowMonths);
  const txs = await prisma.transaction.findMany({
    where: { date: { gte: since }, amount: { lt: 0 }, isTransfer: false, category: { name: category } },
    select: { date: true, amount: true },
  });
  const monthly = new Map<string, number>();
  for (const t of txs) {
    const k = ym(t.date);
    monthly.set(k, (monthly.get(k) ?? 0) + Math.abs(t.amount));
  }
  const vals = [...monthly.values()];
  if (vals.length === 0) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1);
  return { mean, stdev: Math.sqrt(variance), nMonths: vals.length };
}

export async function planDrift(planIdA: string, planIdB: string) {
  const [a, b] = await Promise.all([
    prisma.plan.findUnique({ where: { id: planIdA }, include: { lines: true } }),
    prisma.plan.findUnique({ where: { id: planIdB }, include: { lines: true } }),
  ]);
  if (!a || !b) throw new Error('Plan(s) not found');
  const sumByKey = (lines: { scope: string; scopeKey: string | null; amount: number }[]) => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const k = l.scope === 'category' ? (l.scopeKey ?? 'Other') : 'Overall';
      m.set(k, (m.get(k) ?? 0) + l.amount);
    }
    return m;
  };
  const aMap = sumByKey(a.lines);
  const bMap = sumByKey(b.lines);
  const keys = new Set([...aMap.keys(), ...bMap.keys()]);
  return [...keys].map(k => {
    const av = aMap.get(k) ?? 0;
    const bv = bMap.get(k) ?? 0;
    return { category: k, planA: av, planB: bv, delta: bv - av, pct: av > 0 ? ((bv - av) / av) * 100 : 0 };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
