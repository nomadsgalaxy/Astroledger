import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, makeTx, prisma } from './_fixtures';
import { listEnvelopeProgress, getReadyToAssign } from '../../src/lib/envelopes';

describe('envelopes (integration)', () => {
  beforeEach(reset);

  it('rollover carries available (allocated + carried − spent) across contiguous months', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    const cat = await prisma.category.create({ data: { name: 'Groceries' } });

    // April: budget 200, spend 150 → carries +50
    await prisma.envelope.create({ data: { monthYear: '2026-04', name: 'Groceries', allocated: 200, rollover: true, scope: 'category', categoryId: cat.id } });
    await makeTx(acct.id, -150, { date: new Date('2026-04-10'), categoryId: cat.id });
    // May: budget 200, spend 120 → available = 200 + 50 − 120 = 130
    await prisma.envelope.create({ data: { monthYear: '2026-05', name: 'Groceries', allocated: 200, rollover: true, scope: 'category', categoryId: cat.id } });
    await makeTx(acct.id, -120, { date: new Date('2026-05-10'), categoryId: cat.id });

    const may = await listEnvelopeProgress('2026-05');
    const g = may.find(e => e.name === 'Groceries')!;
    expect(g.spent).toBe(120);
    expect(g.rolledIn).toBe(50);
    expect(g.available).toBe(130);
  });

  it('ready-to-assign = liquid cash − assigned this month', async () => {
    const inst = await makeInstitution();
    // liquid: checking 1000 + savings 500 = 1500; investment excluded
    await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });
    await makeAccount(inst.id, 'Savings', { kind: 'savings_short', balance: 500 });
    await makeAccount(inst.id, 'Brokerage', { kind: 'investment', balance: 9999 });
    const cat = await prisma.category.create({ data: { name: 'Food' } });
    await prisma.envelope.create({ data: { monthYear: '2026-05', name: 'Food', allocated: 300, scope: 'category', categoryId: cat.id } });

    const rta = await getReadyToAssign('2026-05');
    expect(rta.liquid).toBe(1500);
    expect(rta.liquidAccounts).toBe(2);
    expect(rta.assigned).toBe(300);
    expect(rta.readyToAssign).toBe(1200);
  });
});
