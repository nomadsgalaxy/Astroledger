// Income forecaster — the inflow counterpart to composite.ts (which is
// outflow-only). Models total monthly income (positive, non-transfer
// transactions) with Holt-Winters seasonality (paychecks/bonuses follow a
// monthly/seasonal cadence) and an SMA fallback for short histories.
//
// Unlike the category outflow model, income is treated as ONE series rather
// than recurring-floor + variable, because most income is a single dependable
// stream. We still split each projected point into a recurring "dependable
// floor" (a low percentile of recent monthly income — your base paycheck) and a
// variable remainder (bonuses, side income) for the contrib fields, but the
// point itself is the model output, never floor+variable summed.

import { prisma } from '../prisma';
import { fitHoltWinters, forecastHoltWinters, simpleMovingAverage } from './holtWinters';
import type { CompositePoint } from './composite';

const PERIOD = 12;

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

// Dependable monthly income floor: a low quantile of the NON-ZERO monthly
// totals. The 30th percentile shrugs off both empty months (history gaps) and
// one-off windfalls, leaving the income you can count on.
function dependableFloor(series: number[]): number {
  const nonZero = series.filter(v => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return 0;
  const idx = Math.floor(nonZero.length * 0.3);
  return nonZero[Math.min(idx, nonZero.length - 1)];
}

/**
 * Forecast total INFLOWS (income) over `horizonMonths`, one point per month
 * starting next month. Mirrors CompositePoint so it persists through the same
 * Forecast/ForecastPoint path as the outflow forecast.
 */
export async function forecastIncome(horizonMonths: number, anchor: Date = new Date()): Promise<CompositePoint[]> {
  const since = addMonths(firstOfMonth(anchor), -24);
  // Genuine inflows only: positive amount, NOT a transfer (the transferClassify
  // pass on ingest already flags credit-card payments / internal moves), not an
  // anticipated placeholder, and not a split child (the parent carries the real
  // bank amount — counting children would double-count).
  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: since, lt: firstOfMonth(anchor) },
      amount: { gt: 0 }, isTransfer: false, isAnticipated: false, parentTransactionId: null,
    },
    select: { date: true, amount: true },
  });

  const byMonth = new Map<string, number>();
  for (const t of txs) {
    const k = ym(t.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount);
  }
  const series: number[] = [];
  for (let d = since; d < firstOfMonth(anchor); d = addMonths(d, 1)) {
    series.push(byMonth.get(ym(d)) ?? 0);
  }

  const floor = dependableFloor(series);

  let next: (h: number) => { point: number; sigma: number };
  if (series.length >= PERIOD * 2) {
    const fit = fitHoltWinters(series, PERIOD);
    if (fit) {
      next = (h: number) => {
        const f = forecastHoltWinters(fit, PERIOD, h);
        return { point: Math.max(0, f.point), sigma: (f.high80 - f.point) / 1.28 };
      };
    } else {
      const sma = simpleMovingAverage(series);
      next = () => ({ point: sma.point, sigma: sma.stdev });
    }
  } else {
    const sma = simpleMovingAverage(series, Math.max(3, series.length));
    next = () => ({ point: sma.point, sigma: sma.stdev });
  }

  const start = addMonths(firstOfMonth(anchor), 1);
  const points: CompositePoint[] = [];
  for (let h = 1; h <= horizonMonths; h++) {
    const v = next(h);
    const point = v.point;
    const recurring = Math.min(floor, point);
    points.push({
      month: addMonths(start, h - 1),
      point,
      low:  Math.max(0, point - 1.28 * v.sigma),
      high: point + 1.28 * v.sigma,
      contribRecurring: recurring,
      contribVariable: Math.max(0, point - recurring),
    });
  }
  return points;
}
