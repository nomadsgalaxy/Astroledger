// Checkpoint: plan-vs-actual variance with "how to get back on track" suggestions.

import { prisma } from './prisma';

export type CheckpointRow = {
  category: string;
  budgeted: number;
  actual: number;
  variance: number;
  pct: number;          // signed %
  status: 'green' | 'yellow' | 'red';
};

export type CheckpointResult = {
  planId: string;
  planName: string;
  periodLabel: string;
  rows: CheckpointRow[];
  totals: { budgeted: number; actual: number; variance: number };
  daysIntoPeriod: number;
  daysInPeriod: number;
};

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function statusOf(budgeted: number, actual: number, isIncome: boolean): 'green' | 'yellow' | 'red' {
  if (budgeted === 0) return 'green';
  if (isIncome) {
    const pct = (actual - budgeted) / budgeted;
    if (pct < -0.15) return 'red';
    if (pct < -0.05) return 'yellow';
    return 'green';
  }
  const pct = (actual - budgeted) / budgeted;
  if (pct > 0.15) return 'red';
  if (pct > 0.05) return 'yellow';
  return 'green';
}

export async function runCheckpoint(opts: {
  period: 'month' | 'quarter' | 'ytd';
  anchor?: Date;
}): Promise<CheckpointResult | null> {
  const anchor = opts.anchor ?? new Date();
  const plan = await prisma.plan.findFirst({
    where: { status: 'active' },
    include: { lines: true },
    orderBy: { activatedAt: 'desc' },
  });
  if (!plan) return null;

  let periodStart: Date, periodEnd: Date, periodLabel: string;
  if (opts.period === 'month') {
    periodStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    periodEnd   = endOfMonth(anchor);
    periodLabel = anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  } else if (opts.period === 'quarter') {
    const q = Math.floor(anchor.getUTCMonth() / 3);
    periodStart = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3, 1));
    periodEnd   = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999));
    periodLabel = `Q${q + 1} ${anchor.getUTCFullYear()}`;
  } else {
    periodStart = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    periodEnd   = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
    periodLabel = `YTD ${anchor.getUTCFullYear()}`;
  }

  const linesInPeriod = plan.lines.filter(l => l.month >= periodStart && l.month <= periodEnd);
  const budgetByCat = new Map<string, number>();
  for (const l of linesInPeriod) {
    const k = l.scope === 'category' ? l.scopeKey ?? 'Other' : 'Overall';
    budgetByCat.set(k, (budgetByCat.get(k) ?? 0) + l.amount);
  }

  const txs = await prisma.transaction.findMany({
    where: { date: { gte: periodStart, lte: periodEnd }, isTransfer: false },
    include: { category: true },
  });
  const actualByCat = new Map<string, number>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const k = t.category?.name ?? 'Other';
    actualByCat.set(k, (actualByCat.get(k) ?? 0) + Math.abs(t.amount));
  }

  // Pro-rata if mid-period: scale budget by (daysElapsed / daysInPeriod) so the
  // mid-month view isn't misleadingly over.
  const daysIntoPeriod = Math.min(
    Math.ceil((Math.min(+anchor, +periodEnd) - +periodStart) / 86400000),
    Math.ceil((+periodEnd - +periodStart) / 86400000),
  );
  const daysInPeriod = Math.max(1, Math.ceil((+periodEnd - +periodStart) / 86400000));

  const allCats = new Set([...budgetByCat.keys(), ...actualByCat.keys()]);
  const rows: CheckpointRow[] = [];
  let totalBudgeted = 0, totalActual = 0;
  for (const cat of allCats) {
    const fullBudget = budgetByCat.get(cat) ?? 0;
    const prorated = fullBudget * (daysIntoPeriod / daysInPeriod);
    const actual = actualByCat.get(cat) ?? 0;
    const variance = actual - prorated;
    const pct = prorated > 0 ? (variance / prorated) * 100 : (actual > 0 ? 100 : 0);
    rows.push({
      category: cat,
      budgeted: prorated,
      actual,
      variance,
      pct,
      status: statusOf(prorated, actual, false),
    });
    totalBudgeted += prorated; totalActual += actual;
  }
  rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  return {
    planId: plan.id, planName: plan.name, periodLabel, rows,
    totals: { budgeted: totalBudgeted, actual: totalActual, variance: totalActual - totalBudgeted },
    daysIntoPeriod, daysInPeriod,
  };
}
