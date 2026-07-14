import { describe, it, expect, beforeEach } from 'vitest';
import { reset, makeInstitution, makeAccount, makeTx, prisma } from './_fixtures';
import { getReconcileState } from '../../src/lib/reconciliation';

describe('reconciliation (integration)', () => {
  beforeEach(reset);

  it('counts bank-statement lines, excluding split children (the v0.4.1 fix)', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    await makeTx(acct.id, -50, { cleared: true });
    const parent = await makeTx(acct.id, -100, { isSplit: true, cleared: true });
    await makeTx(acct.id, -60, { parentTransactionId: parent.id });
    await makeTx(acct.id, -40, { parentTransactionId: parent.id });

    const st = await getReconcileState(acct.id);
    expect(st).not.toBeNull();
    // -50 + parent -100, children NOT counted → -150 (not -250)
    expect(st!.bookBalance).toBe(-150);
    expect(st!.clearedBalance).toBe(-150);
    // window shows only the 2 bank lines (normal + parent), not the children
    expect(st!.txns).toHaveLength(2);
  });

  it('clearedBalance tracks cleared toggles; reconciled vs unlocked split is correct', async () => {
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id);
    const a = await makeTx(acct.id, -25);
    const b = await makeTx(acct.id, -75);
    let st = await getReconcileState(acct.id);
    expect(st!.clearedBalance).toBe(0);
    expect(st!.bookBalance).toBe(-100);

    await prisma.transaction.update({ where: { id: a.id }, data: { cleared: true } });
    st = await getReconcileState(acct.id);
    expect(st!.clearedBalance).toBe(-25);
    expect(st!.unlockedClearedCount).toBe(1);

    // lock a, then b cleared+locked
    await prisma.transaction.update({ where: { id: a.id }, data: { reconciledAt: new Date() } });
    await prisma.transaction.update({ where: { id: b.id }, data: { cleared: true, reconciledAt: new Date() } });
    st = await getReconcileState(acct.id);
    expect(st!.clearedBalance).toBe(-100);
    expect(st!.reconciledBalance).toBe(-100);
    expect(st!.lockedCount).toBe(2);
    expect(st!.unlockedClearedCount).toBe(0);
  });

  it('reconcile_account books exactly one adjustment + refuses a same-date collision', async () => {
    const { runBudgetTool } = await import('../../src/lib/budgetTools');
    const inst = await makeInstitution();
    const acct = await makeAccount(inst.id, 'Coll Acct');
    await makeTx(acct.id, -100, { cleared: true }); // cleared balance -100

    // statement -75 → residual +25 → adjustment, then more cleared, reconcile again same date+amount
    const r1: any = await runBudgetTool('reconcile_account', { account: acct.id, statement_balance: -75, statement_date: '2026-05-31', create_adjustment: true });
    expect(r1.ok).toBe(true);

    await makeTx(acct.id, -25, { cleared: true }); // cleared back to -100; reconciling -75 → +25 again
    const r2: any = await runBudgetTool('reconcile_account', { account: acct.id, statement_balance: -75, statement_date: '2026-05-31', create_adjustment: true });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('OUT_OF_BALANCE');

    const adjCount = await prisma.transaction.count({ where: { accountId: acct.id, merchant: 'Reconciliation adjustment' } });
    expect(adjCount).toBe(1); // no double-book
  });
});
