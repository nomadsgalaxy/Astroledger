// Top-level forecast runner - persists Forecast + ForecastPoint rows.

import { prisma } from '../prisma';
import { forecastAllCategories } from './composite';
import { forecastIncome } from './income';

const INFLATION_DEFAULT = parseFloat(process.env.INFLATION_DEFAULT ?? '0.035');
// Annual income growth used to extrapolate the long-term (months 13–60) income
// line. Defaults to a modest raise; falls back to the inflation default.
const INCOME_GROWTH_DEFAULT = parseFloat(process.env.INCOME_GROWTH_DEFAULT ?? '0.03');

// Shape of a ForecastPoint create row (sans forecastId, added at insert time).
type PointRow = {
  month: Date; point: number; low: number; high: number;
  contribRecurring?: number; contribVariable?: number;
};

/** Build a 12-month composite forecast for every category, plus an overall sum. */
export async function runForecasts(horizonMonths = 12): Promise<{ categories: number; points: number }> {
  const anchor = new Date();
  const byCategory = await forecastAllCategories(horizonMonths, anchor);

  // Overall = sum across categories
  const monthlySums = new Map<number, { point: number; sigma2: number }>();
  for (const [, points] of byCategory) {
    for (let i = 0; i < points.length; i++) {
      const cur = monthlySums.get(i) ?? { point: 0, sigma2: 0 };
      cur.point += points[i].point;
      // independent additive variance approximation
      const sigma = (points[i].high - points[i].point) / 1.28;
      cur.sigma2 += sigma * sigma;
      monthlySums.set(i, cur);
    }
  }

  // Wipe prior forecasts generated today (keep history for trend lookups).
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  await prisma.forecast.deleteMany({ where: { generatedAt: { gte: todayStart } } });

  let totalPoints = 0;
  // Persist a Forecast + all its points in ONE batched insert. Replaces the
  // old per-point awaited create() loop (≈2800 round-trips → 107s on prod) with
  // one createMany per forecast.
  const persist = async (
    meta: { scope: string; scopeKey?: string; flow: string; method: string; horizonMonths: number; meta?: string },
    points: PointRow[],
  ) => {
    const fc = await prisma.forecast.create({ data: { ...meta, generatedFrom: anchor } });
    if (points.length) {
      await prisma.forecastPoint.createMany({ data: points.map(p => ({ forecastId: fc.id, ...p })) });
      totalPoints += points.length;
    }
    return fc;
  };

  // Per-category outflow composites.
  for (const [cat, points] of byCategory) {
    await persist(
      { scope: 'category', scopeKey: cat, flow: 'outflow', method: 'composite', horizonMonths },
      points.map(p => ({ month: p.month, point: p.point, low: p.low, high: p.high, contribRecurring: p.contribRecurring, contribVariable: p.contribVariable })),
    );
  }

  // Overall outflow composite (sum of categories).
  const startMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const overallPoints: PointRow[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const m = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1));
    const sums = monthlySums.get(i) ?? { point: 0, sigma2: 0 };
    const sigma = Math.sqrt(sums.sigma2);
    overallPoints.push({ month: m, point: sums.point, low: Math.max(0, sums.point - 1.28 * sigma), high: sums.point + 1.28 * sigma });
  }
  await persist({ scope: 'overall', flow: 'outflow', method: 'composite', horizonMonths }, overallPoints);

  // ── Income (inflow) composite ────────────────────────────────────────────
  const incomePoints = await forecastIncome(horizonMonths, anchor);
  await persist(
    { scope: 'overall', flow: 'inflow', method: 'composite', horizonMonths },
    incomePoints.map(p => ({ month: p.month, point: p.point, low: p.low, high: p.high, contribRecurring: p.contribRecurring, contribVariable: p.contribVariable })),
  );

  // ── Net composite (income − outflow). May be negative; no floor. ──────────
  const netPoints: PointRow[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const m = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1));
    const out = monthlySums.get(i) ?? { point: 0, sigma2: 0 };
    const inc = incomePoints[i];
    const incSigma = inc ? (inc.high - inc.point) / 1.28 : 0;
    const netPoint = (inc?.point ?? 0) - out.point;
    const netSigma = Math.sqrt(out.sigma2 + incSigma * incSigma);
    netPoints.push({ month: m, point: netPoint, low: netPoint - 1.28 * netSigma, high: netPoint + 1.28 * netSigma });
  }
  await persist({ scope: 'overall', flow: 'net', method: 'composite', horizonMonths }, netPoints);

  // ── Long-term (months 13–60): extrapolate the month-12 anchors, widen CI ──
  if (horizonMonths >= 12) {
    const outM12 = monthlySums.get(horizonMonths - 1) ?? { point: 0, sigma2: 0 };
    const outBaseSigma = Math.sqrt(outM12.sigma2) || outM12.point * 0.10;
    const longOut: PointRow[] = [];
    for (let m = 13; m <= 60; m++) {
      const futureMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + m, 1));
      const scale = Math.pow(1 + INFLATION_DEFAULT, (m - 12) / 12);
      const point = outM12.point * scale;
      const sigma = outBaseSigma * Math.sqrt(m / 12);
      longOut.push({ month: futureMonth, point, low: Math.max(0, point - 1.28 * sigma), high: point + 1.28 * sigma });
    }
    await persist({ scope: 'overall', flow: 'outflow', method: 'long_term_extrapolation', horizonMonths: 60, meta: JSON.stringify({ inflation: INFLATION_DEFAULT }) }, longOut);

    const incM12 = incomePoints[incomePoints.length - 1];
    if (incM12) {
      const incBaseSigma = (incM12.high - incM12.point) / 1.28 || incM12.point * 0.10;
      const longInc: PointRow[] = [];
      const longNet: PointRow[] = [];
      for (let m = 13; m <= 60; m++) {
        const futureMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + m, 1));
        const incScale = Math.pow(1 + INCOME_GROWTH_DEFAULT, (m - 12) / 12);
        const incPoint = incM12.point * incScale;
        const incSigma = incBaseSigma * Math.sqrt(m / 12);
        longInc.push({ month: futureMonth, point: incPoint, low: Math.max(0, incPoint - 1.28 * incSigma), high: incPoint + 1.28 * incSigma });
        const outScale = Math.pow(1 + INFLATION_DEFAULT, (m - 12) / 12);
        const outPoint = outM12.point * outScale;
        const outSigma = outBaseSigma * Math.sqrt(m / 12);
        const netPoint = incPoint - outPoint;
        const netSigma = Math.sqrt(incSigma * incSigma + outSigma * outSigma);
        longNet.push({ month: futureMonth, point: netPoint, low: netPoint - 1.28 * netSigma, high: netPoint + 1.28 * netSigma });
      }
      await persist({ scope: 'overall', flow: 'inflow', method: 'long_term_extrapolation', horizonMonths: 60, meta: JSON.stringify({ incomeGrowth: INCOME_GROWTH_DEFAULT }) }, longInc);
      await persist({ scope: 'overall', flow: 'net', method: 'long_term_extrapolation', horizonMonths: 60, meta: JSON.stringify({ incomeGrowth: INCOME_GROWTH_DEFAULT, inflation: INFLATION_DEFAULT }) }, longNet);
    }
  }

  return { categories: byCategory.size, points: totalPoints };
}
