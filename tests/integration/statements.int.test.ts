import { describe, it, expect, beforeEach } from 'vitest';
import { reset, prisma, makeInstitution, makeAccount, makeTx } from './_fixtures';
import { buildBalanceSheet, buildIncomeStatement, buildCashFlowStatement } from '../../src/lib/statements';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
const PERIOD = { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-31T23:59:59.999Z') };

describe('financial statements (integration)', () => {
  beforeEach(reset);

  it('Balance Sheet: assets vs liabilities by kind, abs liabilities, null balances skipped', async () => {
    const inst = await makeInstitution();
    await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });
    await makeAccount(inst.id, 'Brokerage', { kind: 'investment', balance: 5000 });
    await makeAccount(inst.id, 'Visa', { kind: 'credit', balance: 200 });        // stored positive
    await makeAccount(inst.id, 'Mortgage', { kind: 'loan', balance: -3000 });     // stored negative
    await makeAccount(inst.id, 'Unknown', { kind: 'checking', balance: null });   // excluded

    const bs = await buildBalanceSheet();
    expect(bs.totalAssets).toBe(6000);
    expect(bs.totalLiabilities).toBe(3200);   // |200| + |-3000|
    expect(bs.netWorth).toBe(2800);

    const assetKinds = bs.assets.map(g => g.kind).sort();
    expect(assetKinds).toEqual(['checking', 'investment']);
    const liabKinds = bs.liabilities.map(g => g.kind).sort();
    expect(liabKinds).toEqual(['credit', 'loan']);

    // the loan liability is reported as a positive magnitude
    const loan = bs.liabilities.find(g => g.kind === 'loan')!;
    expect(loan.total).toBe(3000);
    expect(loan.accounts[0].balance).toBe(3000);

    // the null-balance account produced an exclusion note
    expect(bs.notes.some(n => /no balance on file/.test(n))).toBe(true);
  });

  it('Income Statement: sign-based income/expense, excludes transfers/anticipated/split-parents', async () => {
    const inst = await makeInstitution();
    const acc = await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });

    await makeTx(acc.id, 2000, { date: D(2026, 5, 10) });   // income
    await makeTx(acc.id, -500, { date: D(2026, 5, 12) });   // expense
    await makeTx(acc.id, -300, { date: D(2026, 5, 14), isTransfer: true, transferGroupId: 'g1' }); // excluded
    await makeTx(acc.id, 999, { date: D(2026, 5, 15), isAnticipated: true }); // excluded
    await makeTx(acc.id, -777, { date: D(2026, 4, 1) });    // outside period, excluded

    // split: parent (isSplit) excluded, two children counted
    const parent = await makeTx(acc.id, -100, { date: D(2026, 5, 20), isSplit: true });
    await makeTx(acc.id, -60, { date: D(2026, 5, 20), parentTransactionId: parent.id });
    await makeTx(acc.id, -40, { date: D(2026, 5, 20), parentTransactionId: parent.id });

    const is = await buildIncomeStatement(PERIOD);
    expect(is.totalIncome).toBe(2000);
    expect(is.totalExpenses).toBe(600);    // 500 + 60 + 40 (NOT the 100 parent)
    expect(is.netIncome).toBe(1400);
    expect(is.income).toHaveLength(1);
    expect(is.income[0].bucket).toBe('Other income');
    expect(is.expenses.find(l => l.bucket === 'Uncategorized')!.total).toBe(600);
  });

  it('Income Statement: buckets by primary tag (single attribution)', async () => {
    const inst = await makeInstitution();
    const acc = await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 0 });
    const groceries = await prisma.tag.create({ data: { name: 'Groceries', kind: 'primary' } });
    const t = await makeTx(acc.id, -120, { date: D(2026, 5, 8) });
    await prisma.transaction.update({ where: { id: t.id }, data: { tags: { connect: { id: groceries.id } } } });

    const is = await buildIncomeStatement(PERIOD);
    expect(is.expenses).toHaveLength(1);
    expect(is.expenses[0].bucket).toBe('Groceries');
    expect(is.expenses[0].total).toBe(120);
  });

  it('Cash Flow: operating/investing/financing decompose, beginning + net change = ending', async () => {
    const inst = await makeInstitution();
    const checking = await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });
    const savings = await makeAccount(inst.id, 'Savings', { kind: 'savings_short', balance: 500 });
    const brokerage = await makeAccount(inst.id, 'Brokerage', { kind: 'investment', balance: 9999 });
    const visa = await makeAccount(inst.id, 'Visa', { kind: 'credit', balance: 100 });

    // operating
    await makeTx(checking.id, 2000, { date: D(2026, 5, 5) });
    await makeTx(checking.id, -500, { date: D(2026, 5, 6) });
    // investing: checking -> brokerage (only the checking leg is liquid)
    await makeTx(checking.id, -300, { date: D(2026, 5, 10), isTransfer: true, transferGroupId: 'inv' });
    await makeTx(brokerage.id, 300, { date: D(2026, 5, 10), isTransfer: true, transferGroupId: 'inv' });
    // financing: checking -> visa (debt paydown)
    await makeTx(checking.id, -100, { date: D(2026, 5, 12), isTransfer: true, transferGroupId: 'pay' });
    await makeTx(visa.id, 100, { date: D(2026, 5, 12), isTransfer: true, transferGroupId: 'pay' });
    // internal liquid<->liquid: checking -> savings (nets to zero)
    await makeTx(checking.id, -200, { date: D(2026, 5, 15), isTransfer: true, transferGroupId: 'mov' });
    await makeTx(savings.id, 200, { date: D(2026, 5, 15), isTransfer: true, transferGroupId: 'mov' });

    const cf = await buildCashFlowStatement(PERIOD);
    expect(cf.operating.inflows).toBe(2000);
    expect(cf.operating.outflows).toBe(500);
    expect(cf.operating.net).toBe(1500);
    expect(cf.investing.net).toBe(-300);
    expect(cf.financing.net).toBe(-100);
    expect(cf.other.net).toBe(0);            // liquid<->liquid legs cancel
    expect(cf.netChangeInCash).toBe(1100);   // 1500 - 300 - 100
    expect(cf.endingCash).toBe(1500);        // current checking + savings, no post-period tx
    expect(cf.beginningCash).toBe(400);      // 1500 - 1100
    expect(cf.beginningCash! + cf.netChangeInCash).toBe(cf.endingCash);
  });

  it('Cash Flow: counts the split parent (bank line), not children — no double-count', async () => {
    const inst = await makeInstitution();
    const checking = await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });
    // a $100 charge split $60 + $40 on a liquid account: parent (real bank line)
    // + two children, all on the same account. Cash flow must count 100, not 200.
    const parent = await makeTx(checking.id, -100, { date: D(2026, 5, 18), isSplit: true });
    await makeTx(checking.id, -60, { date: D(2026, 5, 18), parentTransactionId: parent.id });
    await makeTx(checking.id, -40, { date: D(2026, 5, 18), parentTransactionId: parent.id });

    const cf = await buildCashFlowStatement(PERIOD);
    expect(cf.operating.outflows).toBe(100);     // parent only, NOT 200
    expect(cf.netChangeInCash).toBe(-100);
    expect(cf.endingCash).toBe(1000);
    expect(cf.beginningCash).toBe(1100);
    expect(cf.beginningCash! + cf.netChangeInCash).toBe(cf.endingCash);
  });

  it('Cash Flow: ending cash backs out transactions after the period end', async () => {
    const inst = await makeInstitution();
    const checking = await makeAccount(inst.id, 'Checking', { kind: 'checking', balance: 1000 });
    await makeTx(checking.id, -50, { date: D(2026, 5, 20) });   // in period
    await makeTx(checking.id, 250, { date: D(2026, 6, 10) });   // AFTER period end

    const cf = await buildCashFlowStatement(PERIOD);
    // ending = current 1000 minus the +250 that happened after the period = 750
    expect(cf.endingCash).toBe(750);
    expect(cf.netChangeInCash).toBe(-50);
    expect(cf.beginningCash).toBe(800);
  });
});
