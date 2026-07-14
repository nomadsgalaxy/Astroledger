import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, makeTx, prisma } from './_fixtures';
import { runForecasts } from '../../src/lib/forecast';

// Seed 18 months of regular ~$5000 income + ~$3000 spending so the forecaster
// has enough history (≥ PERIOD*2 = 24 ideally; SMA fallback otherwise) to
// produce inflow/outflow/net lines.
async function seedHistory(accountId: string) {
  const now = new Date();
  for (let m = 1; m <= 18; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 15));
    await makeTx(accountId, 5000, { date: d, merchant: 'Payroll', rawDescription: 'Direct Deposit Payroll' });
    await makeTx(accountId, -3000, { date: d, merchant: 'Rent', rawDescription: 'Rent' });
  }
}

describe('income forecasting (integration)', () => {
  beforeEach(reset);

  it('runForecasts produces inflow + outflow + net composites, and net == income − outflow', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    await prisma.category.create({ data: { name: 'Housing' } });
    await seedHistory(acct.id);

    const r = await runForecasts(12);
    expect(r.points).toBeGreaterThan(0);

    const fcs = await prisma.forecast.findMany({
      where: { scope: 'overall', method: 'composite' },
      include: { points: { orderBy: { month: 'asc' } } },
    });
    const inflow = fcs.find(f => f.flow === 'inflow');
    const outflow = fcs.find(f => f.flow === 'outflow');
    const net = fcs.find(f => f.flow === 'net');
    expect(inflow).toBeTruthy();
    expect(outflow).toBeTruthy();
    expect(net).toBeTruthy();
    expect(inflow!.points).toHaveLength(12);

    // Per-month: net == income − outflow (within a cent)
    for (let i = 0; i < 12; i++) {
      const expected = inflow!.points[i].point - outflow!.points[i].point;
      expect(Math.abs(net!.points[i].point - expected)).toBeLessThan(0.01);
    }
    // Income should be positive given the seeded paychecks
    const incomeTotal = inflow!.points.reduce((s, p) => s + p.point, 0);
    expect(incomeTotal).toBeGreaterThan(0);
  });

  it('forecast_summary MCP verb returns a net that equals income − spending', async () => {
    const { runBudgetTool } = await import('../../src/lib/budgetTools');
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    await seedHistory(acct.id);
    await runForecasts(12);

    const r: any = await runBudgetTool('forecast_summary', {});
    expect(r.forecast12mo.monthly).toHaveLength(12);
    expect(Math.abs(r.forecast12mo.projectedNet - (r.forecast12mo.projectedIncome - r.forecast12mo.projectedSpending))).toBeLessThan(0.5);
  });
});
