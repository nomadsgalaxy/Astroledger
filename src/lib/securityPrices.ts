// Live security price refresh (v0.5.0) — BYO-key adapter. Holdings carry a
// `marketValue` that's only as fresh as the last SimpleFIN sync / QIF import.
// This fetches current quotes for exchange-listed holdings and updates
// marketValue + writes a SecurityPrice point, so the holdings/net-worth pages
// reflect today's prices.
//
// Provider is chosen by which API key is set (priority: Polygon → Finnhub →
// Alpha Vantage). No key → no-op with a clear "configure a key" result. Free
// tiers are rate-limited (Polygon 5/min), so we throttle between requests and
// stop cleanly on a 429, reporting partial progress.

import { prisma } from './prisma';

class RateLimitError extends Error {}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
function utcMidnight(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

// Only fetch for things that look like real exchange tickers (1–6 uppercase
// letters). Mutual funds carried as names/CUSIPs have no quote endpoint.
export function isTickerLike(symbol: string): boolean {
  return /^[A-Z]{1,6}$/.test(symbol.trim());
}

export type PriceProvider = 'polygon' | 'finnhub' | 'alphavantage' | null;
export function priceProvider(): PriceProvider {
  if (process.env.POLYGON_API_KEY) return 'polygon';
  if (process.env.FINNHUB_API_KEY) return 'finnhub';
  if (process.env.ALPHAVANTAGE_API_KEY) return 'alphavantage';
  return null;
}

// Fetch a quote (native currency) for a ticker. Returns null on a clean miss
// (not found / unparseable); throws RateLimitError on a 429 so the caller can
// stop and report partial progress.
async function fetchQuote(symbol: string, provider: PriceProvider): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    if (provider === 'polygon') {
      const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${process.env.POLYGON_API_KEY}`, { signal: ctrl.signal });
      if (res.status === 429) throw new RateLimitError();
      if (!res.ok) return null;
      const j = await res.json() as { results?: Array<{ c?: number }> };
      const c = j?.results?.[0]?.c;
      return typeof c === 'number' && c > 0 ? c : null;
    }
    if (provider === 'finnhub') {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`, { signal: ctrl.signal });
      if (res.status === 429) throw new RateLimitError();
      if (!res.ok) return null;
      const j = await res.json() as { c?: number };
      return typeof j?.c === 'number' && j.c > 0 ? j.c : null;
    }
    if (provider === 'alphavantage') {
      const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${process.env.ALPHAVANTAGE_API_KEY}`, { signal: ctrl.signal });
      if (res.status === 429) throw new RateLimitError();
      if (!res.ok) return null;
      const j = await res.json() as { 'Global Quote'?: { '05. price'?: string }; Note?: string };
      if (j?.Note) throw new RateLimitError(); // AV signals throttling with a "Note"
      const p = parseFloat(j?.['Global Quote']?.['05. price'] ?? '');
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type RefreshResult = {
  provider: PriceProvider;
  configured: boolean;
  updated: number;
  failed: number;       // fetched but no usable quote
  skipped: number;      // non-ticker (mutual funds etc.)
  rateLimited: boolean; // stopped early on a 429
  note?: string;
};

export async function refreshHoldingPrices(): Promise<RefreshResult> {
  const provider = priceProvider();
  if (!provider) {
    return { provider: null, configured: false, updated: 0, failed: 0, skipped: 0, rateLimited: false,
      note: 'No price provider configured. Set POLYGON_API_KEY (or FINNHUB_API_KEY / ALPHAVANTAGE_API_KEY) in the environment.' };
  }
  const delay = Math.max(0, parseInt(process.env.PRICE_FETCH_DELAY_MS ?? '300', 10) || 0);
  const holdings = await prisma.holding.findMany({ select: { id: true, symbol: true, units: true, securityId: true } });

  let updated = 0, failed = 0, skipped = 0, rateLimited = false;
  for (const h of holdings) {
    if (!isTickerLike(h.symbol)) { skipped++; continue; }
    let price: number | null;
    try {
      price = await fetchQuote(h.symbol, provider);
    } catch (e) {
      if (e instanceof RateLimitError) { rateLimited = true; break; }
      failed++; continue;
    }
    if (price == null) { failed++; continue; }
    const now = new Date();
    await prisma.holding.update({ where: { id: h.id }, data: { marketValue: round2(h.units * price), lastPriceAsOf: now } });
    if (h.securityId) {
      await prisma.securityPrice.upsert({
        where: { securityId_date: { securityId: h.securityId, date: utcMidnight(now) } },
        update: { price },
        create: { securityId: h.securityId, date: utcMidnight(now), price },
      });
    }
    updated++;
    if (delay) await sleep(delay);
  }
  return {
    provider, configured: true, updated, failed, skipped, rateLimited,
    note: rateLimited ? 'Hit the provider rate limit — refreshed what we could; run again in a minute for the rest.' : undefined,
  };
}
