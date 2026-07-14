// What-if scenarios + savings runway (v0.5.0).
//
// Runway = how long your liquid savings last at your current monthly net
// cashflow (income − spending), or — if you're net-positive — how fast they
// grow. Stackable Scenario adjustments (a raise, a new subscription, cutting a
// cost) shift the monthly net so you can see the effect on the multi-year
// trajectory.

import { prisma } from './prisma';
import { resolvedKind, type AccountKind } from './accountKind';

const LIQUID_KINDS = new Set<AccountKind>(['checking', 'savings_short', 'savings_long', 'wallet']);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type RunwayPoint = { month: string; balance: number }; // YYYY-MM, projected liquid balance
export type Runway = {
  liquidStart: number;
  monthlyNet: number;            // income − spending (+ scenario deltas)
  status: 'growing' | 'depleting' | 'flat';
  runwayMonths: number | null;   // months until $0 when depleting; null when growing/flat
  depletionDate: string | null;  // ISO date when balance hits $0
  annualChange: number;          // monthlyNet * 12 (signed)
  projection: RunwayPoint[];     // monthly liquid balance over the horizon
};

// Pure: given a starting liquid balance and a monthly net, project the balance
// and derive the runway. Horizon caps the projection (default 5 years).
export function computeRunway(liquidStart: number, monthlyNet: number, horizonMonths = 60): Runway {
  const net = round2(monthlyNet);
  const status: Runway['status'] = Math.abs(net) < 0.5 ? 'flat' : net > 0 ? 'growing' : 'depleting';

  let runwayMonths: number | null = null;
  let depletionDate: string | null = null;
  if (status === 'depleting') {
    runwayMonths = Math.max(0, Math.floor(liquidStart / Math.abs(net)));
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + runwayMonths);
    depletionDate = d.toISOString().slice(0, 10);
  }

  const projection: RunwayPoint[] = [];
  const start = new Date();
  for (let i = 1; i <= horizonMonths; i++) {
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const bal = round2(liquidStart + net * i);
    projection.push({ month: m.toISOString().slice(0, 7), balance: bal });
    if (status === 'depleting' && bal <= 0) { projection[projection.length - 1].balance = 0; break; }
  }

  return {
    liquidStart: round2(liquidStart),
    monthlyNet: net,
    status,
    runwayMonths,
    depletionDate,
    annualChange: round2(net * 12),
    projection,
  };
}

// Current liquid savings = sum of spendable-cash account balances.
export async function liquidBalance(): Promise<number> {
  const accts = await prisma.bankAccount.findMany({ select: { kind: true, type: true, subtype: true, name: true, balance: true } });
  let sum = 0;
  for (const a of accts) if (LIQUID_KINDS.has(resolvedKind(a))) sum += a.balance ?? 0;
  return round2(sum);
}

// Baseline monthly net. Prefer the latest forecast composites (projected income
// − spending, averaged over the horizon); fall back to the last 3 complete
// months of actuals when no forecast has been generated.
export async function baselineMonthlyNet(): Promise<{ monthlyNet: number; source: 'forecast' | 'actuals' | 'none' }> {
  const [inc, out] = await Promise.all([
    prisma.forecast.findFirst({ where: { scope: 'overall', method: 'composite', flow: 'inflow' }, orderBy: { generatedAt: 'desc' }, include: { points: true } }),
    prisma.forecast.findFirst({ where: { scope: 'overall', method: 'composite', flow: 'outflow' }, orderBy: { generatedAt: 'desc' }, include: { points: true } }),
  ]);
  if (inc?.points.length && out?.points.length) {
    const avg = (ps: { point: number }[]) => ps.reduce((s, p) => s + p.point, 0) / ps.length;
    return { monthlyNet: round2(avg(inc.points) - avg(out.points)), source: 'forecast' };
  }

  // Fallback: last 3 complete calendar months of actuals.
  const now = new Date();
  const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const txs = await prisma.transaction.findMany({
    where: { date: { gte: since, lt: startOfThisMonth }, isTransfer: false, parentTransactionId: null },
    select: { amount: true },
  });
  if (txs.length === 0) return { monthlyNet: 0, source: 'none' };
  const net = txs.reduce((s, t) => s + t.amount, 0) / 3; // 3 months
  return { monthlyNet: round2(net), source: 'actuals' };
}

export type ScenarioRunway = Runway & {
  baseMonthlyNet: number;
  appliedDelta: number;
  source: 'forecast' | 'actuals' | 'none';
};

// Runway with a set of monthly deltas applied on top of the baseline.
export async function runwayWithDeltas(deltas: number[], horizonMonths = 60): Promise<ScenarioRunway> {
  const [liquid, base] = await Promise.all([liquidBalance(), baselineMonthlyNet()]);
  const appliedDelta = round2(deltas.reduce((s, d) => s + d, 0));
  const r = computeRunway(liquid, base.monthlyNet + appliedDelta, horizonMonths);
  return { ...r, baseMonthlyNet: base.monthlyNet, appliedDelta, source: base.source };
}

// Headline runway = baseline + every ACTIVE scenario's adjustments stacked.
export async function headlineRunway(horizonMonths = 60): Promise<ScenarioRunway> {
  const active = await prisma.scenario.findMany({ where: { active: true }, include: { adjustments: true } });
  const deltas = active.flatMap(s => s.adjustments.map(a => a.monthlyDelta));
  return runwayWithDeltas(deltas, horizonMonths);
}

// Per-scenario runway (baseline + just that scenario's adjustments).
export async function scenarioRunway(scenarioId: string, horizonMonths = 60): Promise<ScenarioRunway | null> {
  const s = await prisma.scenario.findUnique({ where: { id: scenarioId }, include: { adjustments: true } });
  if (!s) return null;
  return runwayWithDeltas(s.adjustments.map(a => a.monthlyDelta), horizonMonths);
}
