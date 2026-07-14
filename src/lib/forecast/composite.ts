// Composite per-category forecaster:
//   forecast = recurring_floor + variable_holt_winters
// Recurring subscriptions are deterministic; variable spend is statistical.

import { prisma } from '../prisma';
import { fitHoltWinters, forecastHoltWinters, simpleMovingAverage } from './holtWinters';

const PERIOD = 12;

const ALL_RECURRING_CATEGORIES = new Set([
  'Housing', 'Internet', 'Phone', 'Utilities',
]);
const HIGH_VARIANCE_CATEGORIES = new Set([
  'Travel', 'Shopping', 'Gifts',
]);

export type CompositePoint = {
  month: Date;
  point: number;
  low: number;
  high: number;
  contribRecurring: number;
  contribVariable: number;
};

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/**
 * Forecast outflows for a single category over `horizonMonths`.
 * Returns one point per month starting next month.
 */
export async function forecastCategory(categoryName: string, horizonMonths: number, anchor: Date = new Date()): Promise<CompositePoint[]> {
  // --- Recurring floor: sum of monthly equivalents of active subs in this category.
  const subs = await prisma.subscription.findMany({
    where: { status: 'active', category: { name: categoryName } },
  });
  const recurringMonthly = subs.reduce((s, x) => s + x.amount * (30 / Math.max(1, x.cadenceDays)), 0);
  const isAllRecurring = ALL_RECURRING_CATEGORIES.has(categoryName);
  const widenFactor = HIGH_VARIANCE_CATEGORIES.has(categoryName) ? 1.5 : 1.0;

  // --- Variable component: historical outflows by month, excluding subscription-linked txns.
  const since = addMonths(firstOfMonth(anchor), -24);
  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: since, lt: firstOfMonth(anchor) },
      amount: { lt: 0 }, isTransfer: false,
      category: { name: categoryName },
    },
    select: { date: true, amount: true, subscriptionId: true },
  });

  const byMonth = new Map<string, number>();
  for (const t of txs) {
    if (t.subscriptionId) continue; // subscription portion handled by recurring floor
    const k = ym(t.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + Math.abs(t.amount));
  }
  const series: number[] = [];
  for (let d = since; d < firstOfMonth(anchor); d = addMonths(d, 1)) {
    series.push(byMonth.get(ym(d)) ?? 0);
  }

  let variableNext: (h: number) => { point: number; sigma: number };
  if (series.length >= PERIOD * 2) {
    const fit = fitHoltWinters(series, PERIOD);
    if (fit) {
      variableNext = (h: number) => {
        const f = forecastHoltWinters(fit, PERIOD, h);
        return { point: Math.max(0, f.point), sigma: (f.high80 - f.point) / 1.28 };
      };
    } else {
      const sma = simpleMovingAverage(series);
      variableNext = () => ({ point: sma.point, sigma: sma.stdev });
    }
  } else {
    const sma = simpleMovingAverage(series, Math.max(3, series.length));
    variableNext = () => ({ point: sma.point, sigma: sma.stdev });
  }

  if (isAllRecurring) {
    // Recurring-only categories: zero variable signal, fixed monthly value.
    variableNext = () => ({ point: 0, sigma: 0 });
  }

  const start = addMonths(firstOfMonth(anchor), 1);
  const points: CompositePoint[] = [];
  for (let h = 1; h <= horizonMonths; h++) {
    const v = variableNext(h);
    const point = recurringMonthly + v.point;
    const sigma = v.sigma * widenFactor;
    points.push({
      month: addMonths(start, h - 1),
      point,
      low:  Math.max(0, point - 1.28 * sigma),
      high: point + 1.28 * sigma,
      contribRecurring: recurringMonthly,
      contribVariable: v.point,
    });
  }
  return points;
}

/** Forecast all categories - returns map keyed by category name. */
export async function forecastAllCategories(horizonMonths: number, anchor: Date = new Date()) {
  const categories = await prisma.category.findMany({
    where: { name: { notIn: ['Income', 'Transfers'] } },
  });
  const out = new Map<string, CompositePoint[]>();
  for (const c of categories) {
    out.set(c.name, await forecastCategory(c.name, horizonMonths, anchor));
  }
  return out;
}
