import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, prisma } from './_fixtures';
import { holdingsSummary } from '../../src/lib/holdings';

describe('holdingsSummary (integration)', () => {
  beforeEach(reset);

  it('totals + gain in base currency, FX-converting foreign holdings', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id, 'Brokerage', { kind: 'investment' });
    // USD holding: MV 1000, CB 800
    await prisma.holding.create({ data: { accountId: acct.id, symbol: 'VTI', units: 5, marketValue: 1000, costBasis: 800, currency: 'USD' } });
    // EUR holding: MV 900 EUR, CB 900 EUR; 1 USD = 0.9 EUR → /0.9 = 1000 USD each
    await prisma.holding.create({ data: { accountId: acct.id, symbol: 'EZU', units: 10, marketValue: 900, costBasis: 900, currency: 'EUR' } });
    await prisma.fxRate.create({ data: { date: new Date(Date.UTC(2026, 0, 1)), quote: 'EUR', rate: 0.9 } });

    const s = await holdingsSummary();
    expect(s.totalMarketValue).toBe(2000);   // 1000 + 900/0.9
    expect(s.totalCostBasis).toBe(1800);     // 800 + 900/0.9
    expect(s.totalGain).toBe(200);
    expect(s.positions).toBe(2);
    expect(s.topHoldings[0].weight + s.topHoldings[1].weight).toBeCloseTo(100, 0);
  });

  it('allocation by account sums to the total', async () => {
    const inst = await makeInstitution();
    const a1 = await makeAccount(inst.id, '401k', { kind: 'investment' });
    const a2 = await makeAccount(inst.id, 'Roth', { kind: 'investment' });
    await prisma.holding.create({ data: { accountId: a1.id, symbol: 'AAA', units: 1, marketValue: 3000, costBasis: 2500, currency: 'USD' } });
    await prisma.holding.create({ data: { accountId: a2.id, symbol: 'BBB', units: 1, marketValue: 1000, costBasis: 1100, currency: 'USD' } });
    const s = await holdingsSummary();
    expect(s.totalMarketValue).toBe(4000);
    expect(s.byAccount).toHaveLength(2);
    expect(s.byAccount.reduce((sum, x) => sum + x.marketValue, 0)).toBe(4000);
    expect(s.byAccount[0].account).toBe('401k'); // sorted by MV desc
  });
});
