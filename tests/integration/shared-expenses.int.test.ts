import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, reset, makeTx } from './_fixtures';
import { ensureUserFinancialSpaces, resolveRequestAccess } from '../../src/lib/financialAccess';
import { createSharedExpense, listSharedExpenses, reopenExpenseShare, settleExpenseShare } from '../../src/lib/sharedExpenses';

async function household() {
  const owner = await prisma.user.create({ data: { email: 'payer@example.com', name: 'Payer' } });
  const partner = await prisma.user.create({ data: { email: 'partner@example.com', name: 'Partner' } });
  const home = await prisma.household.create({ data: { name: 'Home' } });
  await prisma.householdMember.create({ data: { householdId: home.id, userId: owner.id, role: 'owner' } });
  await ensureUserFinancialSpaces(prisma, owner.id);
  const spaceId = `space_hh_${home.id}`;
  await prisma.financialSpaceMember.create({ data: { spaceId, userId: partner.id, role: 'manager' } });
  const institution = await prisma.institution.create({ data: { name: 'Bank', source: 'manual', ownerSpaceId: spaceId } });
  const account = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: spaceId, name: 'Joint', type: 'depository' } });
  const token = `sess-${owner.id}`;
  await prisma.session.create({ data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 60_000) } });
  const access = (await resolveRequestAccess(prisma, token, spaceId))!;
  return { owner, partner, spaceId, account, access };
}

describe('shared expenses and settlement (integration)', () => {
  beforeEach(reset);

  it('splits a charge equally, settles the payer share, and notifies the others', async () => {
    const { owner, partner, spaceId, account, access } = await household();
    const dinner = await makeTx(account.id, -100, { merchant: 'Bistro' });
    const expense = await createSharedExpense(access, {
      transactionId: dinner.id,
      shares: [{ userId: owner.id }, { userId: partner.id }, { label: 'Visiting friend' }],
    });
    const amounts = expense.shares.map(share => share.amount);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(100, 2);
    const payerShare = expense.shares.find(share => share.userId === owner.id)!;
    expect(payerShare.settledAt).not.toBeNull();
    expect(expense.shares.filter(share => !share.settledAt)).toHaveLength(2);
    expect(await prisma.spaceNotification.count({ where: { userId: partner.id, kind: 'split' } })).toBe(1);
    expect(await prisma.spaceAuditEvent.count({ where: { spaceId, action: 'split.create' } })).toBe(1);
  });

  it('supports percentage splits with rounding correction and rejects bad totals', async () => {
    const { owner, partner, account, access } = await household();
    const utility = await makeTx(account.id, -99.99, { merchant: 'Utility' });
    const expense = await createSharedExpense(access, {
      transactionId: utility.id, splitMode: 'percentage',
      shares: [{ userId: owner.id, percentage: 33.33 }, { userId: partner.id, percentage: 66.67 }],
    });
    expect(expense.shares.map(share => share.amount).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(99.99, 2);

    const second = await makeTx(account.id, -50, { merchant: 'Other' });
    await expect(createSharedExpense(access, {
      transactionId: second.id, splitMode: 'percentage',
      shares: [{ userId: owner.id, percentage: 40 }, { userId: partner.id, percentage: 40 }],
    })).rejects.toMatchObject({ status: 400 });
    await expect(createSharedExpense(access, {
      transactionId: second.id, splitMode: 'fixed',
      shares: [{ userId: owner.id, amount: 10 }, { userId: partner.id, amount: 10 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses inflows, duplicate splits, and non-member participants', async () => {
    const { owner, account, access } = await household();
    const payday = await makeTx(account.id, 500);
    await expect(createSharedExpense(access, { transactionId: payday.id, shares: [{ userId: owner.id }] }))
      .rejects.toMatchObject({ status: 400 });
    const outsider = await prisma.user.create({ data: { email: 'outsider@example.com' } });
    const charge = await makeTx(account.id, -40);
    await expect(createSharedExpense(access, { transactionId: charge.id, shares: [{ userId: outsider.id }] }))
      .rejects.toMatchObject({ status: 403 });
    await createSharedExpense(access, { transactionId: charge.id, shares: [{ userId: owner.id }, { label: 'Sam' }] });
    await expect(createSharedExpense(access, { transactionId: charge.id, shares: [{ label: 'Again' }] }))
      .rejects.toBeTruthy(); // unique transactionId
  });

  it('settles with a linked reimbursement (marked as transfer) and reopens cleanly', async () => {
    const { owner, partner, account, access } = await household();
    const groceries = await makeTx(account.id, -80, { merchant: 'Market' });
    const expense = await createSharedExpense(access, {
      transactionId: groceries.id, shares: [{ userId: owner.id }, { userId: partner.id }],
    });
    const owed = expense.shares.find(share => share.userId === partner.id)!;
    const reimbursement = await makeTx(account.id, 40, { rawDescription: 'Venmo from Partner' });

    await settleExpenseShare(access, owed.id, { settlementTransactionId: reimbursement.id });
    expect((await prisma.transaction.findUnique({ where: { id: reimbursement.id } }))!.isTransfer).toBe(true);
    expect((await prisma.sharedExpense.findUnique({ where: { id: expense.id } }))!.status).toBe('settled');
    expect(await prisma.spaceNotification.count({ where: { userId: partner.id, kind: 'split' } })).toBe(2);

    await reopenExpenseShare(access, owed.id);
    const after = await prisma.sharedExpense.findUnique({ where: { id: expense.id }, include: { shares: true } });
    expect(after!.status).toBe('open');
    expect(after!.shares.find(share => share.id === owed.id)!.settledAt).toBeNull();
  });

  it('reports who owes whom and blocks members without manage access', async () => {
    const { owner, partner, account, access } = await household();
    const charge = await makeTx(account.id, -60);
    await createSharedExpense(access, { transactionId: charge.id, shares: [{ userId: owner.id }, { userId: partner.id }] });

    const summaryForPayer = (await listSharedExpenses(access)).summary;
    expect(summaryForPayer.owedToYou).toBeCloseTo(30, 2);
    expect(summaryForPayer.youOwe).toBe(0);

    const viewer = await prisma.user.create({ data: { email: 'viewer@example.com' } });
    await prisma.financialSpaceMember.create({ data: { spaceId: access.activeSpaceId, userId: viewer.id, role: 'viewer' } });
    const viewerToken = `sess-${viewer.id}`;
    await prisma.session.create({ data: { sessionToken: viewerToken, userId: viewer.id, expires: new Date(Date.now() + 60_000) } });
    const viewerAccess = (await resolveRequestAccess(prisma, viewerToken, access.activeSpaceId))!;
    const another = await makeTx(account.id, -25);
    await expect(createSharedExpense(viewerAccess, { transactionId: another.id, shares: [{ userId: owner.id }] }))
      .rejects.toMatchObject({ status: 403 });
  });
});
