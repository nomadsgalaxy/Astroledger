// Holdings summary (v0.5.0): market value, cost basis, and gain/loss converted
// to the base currency (USD), plus allocation breakdowns. Foreign-currency
// holdings are converted via the FX table; the holdings page previously summed
// raw amounts regardless of currency.

import { prisma } from './prisma';
import { toBase } from './fx';
import { BASE_CURRENCY } from './currencies';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function inBase(amount: number | null | undefined, currency: string, when: Date): Promise<number> {
  if (amount == null) return 0;
  if (!currency || currency === BASE_CURRENCY) return amount;
  const r = await toBase(amount, currency, when);
  return r ? r.base : amount; // no FX rate → assume already comparable rather than drop it
}

export type HoldingsSummary = {
  baseCurrency: string;
  totalMarketValue: number;
  totalCostBasis: number;
  totalGain: number;
  totalGainPct: number | null;
  positions: number;
  lastPriceAsOf: string | null;     // freshest price timestamp across holdings
  byAccount: Array<{ account: string; institution: string; marketValue: number; costBasis: number; gain: number }>;
  topHoldings: Array<{ symbol: string; description: string | null; marketValue: number; costBasis: number; gain: number; currency: string; weight: number }>;
};

export async function holdingsSummary(): Promise<HoldingsSummary> {
  const now = new Date();
  const holdings = await prisma.holding.findMany({
    include: { account: { include: { institution: { select: { name: true } } } } },
  });

  let totalMV = 0, totalCB = 0;
  const acctMap = new Map<string, { account: string; institution: string; marketValue: number; costBasis: number }>();
  const positions: Array<{ symbol: string; description: string | null; marketValue: number; costBasis: number; currency: string }> = [];
  let freshest: Date | null = null;

  for (const h of holdings) {
    const mv = round2(await inBase(h.marketValue, h.currency, now));
    const cb = round2(await inBase(h.costBasis, h.currency, now));
    totalMV += mv; totalCB += cb;
    const key = h.accountId;
    const cur = acctMap.get(key) ?? { account: h.account.name, institution: h.account.institution.name, marketValue: 0, costBasis: 0 };
    cur.marketValue = round2(cur.marketValue + mv);
    cur.costBasis = round2(cur.costBasis + cb);
    acctMap.set(key, cur);
    positions.push({ symbol: h.symbol, description: h.description, marketValue: mv, costBasis: cb, currency: h.currency });
    if (h.lastPriceAsOf && (!freshest || h.lastPriceAsOf > freshest)) freshest = h.lastPriceAsOf;
  }

  totalMV = round2(totalMV); totalCB = round2(totalCB);
  const totalGain = round2(totalMV - totalCB);

  const byAccount = [...acctMap.values()]
    .map(a => ({ ...a, gain: round2(a.marketValue - a.costBasis) }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const topHoldings = positions
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 12)
    .map(p => ({ ...p, gain: round2(p.marketValue - p.costBasis), weight: totalMV > 0 ? round2((p.marketValue / totalMV) * 100) : 0 }));

  return {
    baseCurrency: BASE_CURRENCY,
    totalMarketValue: totalMV,
    totalCostBasis: totalCB,
    totalGain,
    totalGainPct: totalCB > 0 ? round2((totalGain / totalCB) * 100) : null,
    positions: holdings.length,
    lastPriceAsOf: freshest ? freshest.toISOString() : null,
    byAccount,
    topHoldings,
  };
}
