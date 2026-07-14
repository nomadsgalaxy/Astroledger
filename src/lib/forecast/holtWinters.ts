// Holt-Winters triple exponential smoothing (additive seasonal, period=12).
// Pure TypeScript - no native deps. Auto-fits α/β/γ via grid search.
//
// References:
//   - Hyndman & Athanasopoulos, "Forecasting: Principles and Practice", ch 7.3
//   - https://otexts.com/fpp3/holt-winters.html

export type HoltWintersFit = {
  level: number;
  trend: number;
  season: number[];          // length = period
  residualStdev: number;
  alpha: number; beta: number; gamma: number;
  inSampleMAE: number;
};

export type HoltWintersForecast = {
  point: number;
  low80: number; high80: number;
  low95: number; high95: number;
};

/** Fit additive Holt-Winters and return level/trend/seasonal components. */
export function fitHoltWinters(
  y: number[],
  period: number,
  opts: { alpha?: number; beta?: number; gamma?: number } = {},
): HoltWintersFit | null {
  if (y.length < period * 2) return null;

  // If params provided, single fit. Otherwise grid-search.
  if (opts.alpha != null && opts.beta != null && opts.gamma != null) {
    return runFit(y, period, opts.alpha, opts.beta, opts.gamma);
  }

  let best: HoltWintersFit | null = null;
  const grid = [0.1, 0.2, 0.3, 0.5, 0.7];
  for (const a of grid) for (const b of grid) for (const g of grid) {
    const fit = runFit(y, period, a, b, g);
    if (!fit) continue;
    if (!best || fit.inSampleMAE < best.inSampleMAE) best = fit;
  }
  return best;
}

function runFit(y: number[], period: number, alpha: number, beta: number, gamma: number): HoltWintersFit | null {
  if (y.length < period * 2) return null;

  // Initial level = mean of first period; initial trend = (avg of season 2 - avg of season 1) / period
  const firstSeason = y.slice(0, period);
  const secondSeason = y.slice(period, period * 2);
  let level = firstSeason.reduce((s, v) => s + v, 0) / period;
  let trend = (secondSeason.reduce((s, v) => s + v, 0) - firstSeason.reduce((s, v) => s + v, 0)) / (period * period);
  const season = firstSeason.map(v => v - level);

  const residuals: number[] = [];
  for (let t = 0; t < y.length; t++) {
    const seasonIdx = t % period;
    const lastLevel = level;
    const lastTrend = trend;
    const lastSeason = season[seasonIdx];

    const forecast = lastLevel + lastTrend + lastSeason;
    residuals.push(y[t] - forecast);

    level  = alpha * (y[t] - lastSeason) + (1 - alpha) * (lastLevel + lastTrend);
    trend  = beta  * (level - lastLevel) + (1 - beta) * lastTrend;
    season[seasonIdx] = gamma * (y[t] - level) + (1 - gamma) * lastSeason;
  }

  if (!Number.isFinite(level) || !Number.isFinite(trend)) return null;

  const mae = residuals.reduce((s, r) => s + Math.abs(r), 0) / residuals.length;
  const variance = residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length - 1);
  const stdev = Math.sqrt(variance);

  return { level, trend, season, residualStdev: stdev, alpha, beta, gamma, inSampleMAE: mae };
}

/** Forecast h steps ahead using fitted components. */
export function forecastHoltWinters(fit: HoltWintersFit, period: number, h: number): HoltWintersForecast {
  const seasonIdx = (h - 1) % period;
  const point = fit.level + h * fit.trend + fit.season[seasonIdx];
  // Hyndman additive-seasonal CI approximation: σ_h ≈ σ · √(1 + h·c)
  const c = 0.5;
  const sigmaH = fit.residualStdev * Math.sqrt(1 + h * c);
  return {
    point,
    low80: point - 1.28 * sigmaH, high80: point + 1.28 * sigmaH,
    low95: point - 1.96 * sigmaH, high95: point + 1.96 * sigmaH,
  };
}

/** Simple-moving-average fallback for series too short for HW. */
export function simpleMovingAverage(y: number[], window = Math.min(6, y.length)): { point: number; stdev: number } {
  const slice = y.slice(-window);
  const mean = slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length);
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, slice.length - 1);
  return { point: mean, stdev: Math.sqrt(variance) || mean * 0.15 };
}
