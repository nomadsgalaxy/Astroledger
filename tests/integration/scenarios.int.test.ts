import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, prisma } from './_fixtures';
import { headlineRunway, runwayWithDeltas } from '../../src/lib/scenarios';
import { runBudgetTool } from '../../src/lib/budgetTools';

describe('scenarios / runway (integration)', () => {
  beforeEach(reset);

  it('baseline runway from liquid balance + actuals; depletes when net-negative', async () => {
    const inst = await makeInstitution();
    await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 6000 });
    await makeAccount(inst.id, 'Brokerage', { kind: 'investment', balance: 99999 }); // excluded from liquid
    // No forecasts/transactions → baseline net 0 → flat
    const flat = await runwayWithDeltas([]);
    expect(flat.liquidStart).toBe(6000);
    expect(flat.status).toBe('flat');

    // Apply a −1000/mo what-if → depleting, 6 months runway
    const dep = await runwayWithDeltas([-1000]);
    expect(dep.status).toBe('depleting');
    expect(dep.runwayMonths).toBe(6);
    expect(dep.appliedDelta).toBe(-1000);
  });

  it('only ACTIVE scenarios stack into the headline runway', async () => {
    const inst = await makeInstitution();
    await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 10000 });
    const s = await prisma.scenario.create({ data: { name: 'Raise', active: false } });
    await prisma.scenarioAdjustment.create({ data: { scenarioId: s.id, label: '+$2000 raise', monthlyDelta: 2000 } });

    let h = await headlineRunway();
    expect(h.appliedDelta).toBe(0); // inactive → not applied

    await prisma.scenario.update({ where: { id: s.id }, data: { active: true } });
    h = await headlineRunway();
    expect(h.appliedDelta).toBe(2000);
    expect(h.status).toBe('growing');
    expect(h.annualChange).toBe(24000);
  });

  it('scenario_runway MCP verb applies ad-hoc deltas', async () => {
    const inst = await makeInstitution();
    await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 3000 });
    const r: any = await runBudgetTool('scenario_runway', { deltas: [-1500, 500] });
    expect(r.appliedDelta).toBe(-1000);
    expect(r.status).toBe('depleting');
    expect(r.runwayMonths).toBe(3); // 3000 / 1000
  });
});
