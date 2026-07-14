import { describe, it, expect, afterEach } from 'vitest';
import { isTickerLike, priceProvider } from '../src/lib/securityPrices';

describe('isTickerLike', () => {
  it('accepts real exchange tickers (1–6 uppercase letters)', () => {
    for (const s of ['AAPL', 'VTI', 'MSFT', 'F', 'GOOGL']) expect(isTickerLike(s)).toBe(true);
  });
  it('rejects mutual-fund names, CUSIPs, lowercase, and over-long symbols', () => {
    for (const s of ['American Funds 2065', '922908769', 'aapl', 'TOOLONG', 'BRK.B', '']) expect(isTickerLike(s)).toBe(false);
  });
});

describe('priceProvider', () => {
  const saved = { p: process.env.POLYGON_API_KEY, f: process.env.FINNHUB_API_KEY, a: process.env.ALPHAVANTAGE_API_KEY };
  afterEach(() => {
    process.env.POLYGON_API_KEY = saved.p; process.env.FINNHUB_API_KEY = saved.f; process.env.ALPHAVANTAGE_API_KEY = saved.a;
  });
  it('returns null when no key is set', () => {
    delete process.env.POLYGON_API_KEY; delete process.env.FINNHUB_API_KEY; delete process.env.ALPHAVANTAGE_API_KEY;
    expect(priceProvider()).toBeNull();
  });
  it('prefers Polygon, then Finnhub, then Alpha Vantage', () => {
    delete process.env.POLYGON_API_KEY; delete process.env.FINNHUB_API_KEY; delete process.env.ALPHAVANTAGE_API_KEY;
    process.env.ALPHAVANTAGE_API_KEY = 'x'; expect(priceProvider()).toBe('alphavantage');
    process.env.FINNHUB_API_KEY = 'x'; expect(priceProvider()).toBe('finnhub');
    process.env.POLYGON_API_KEY = 'x'; expect(priceProvider()).toBe('polygon');
  });
});
