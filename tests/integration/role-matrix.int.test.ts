import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, reset, makeTx } from './_fixtures';
import { applyFinancialScope, ensureUserFinancialSpaces, resolveRequestAccess, type RequestAccess } from '../../src/lib/financialAccess';
import { createSharedExpense, settleExpenseShare } from '../../src/lib/sharedExpenses';

function scopedFor(access: RequestAccess) {
  const raw = new PrismaClient();
  const scoped = raw.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    return query(await applyFinancialScope(model, operation, args, access));
  } } } });
  return { raw, scoped };
}

async function household() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
  const viewer = await prisma.user.create({ data: { email: 'viewer@example.com', name: 'Viewer' } });
  const home = await prisma.household.create({ data: { name: 'Home' } });
  await prisma.householdMember.create({ data: { householdId: home.id, userId: owner.id, role: 'owner' } });
  await ensureUserFinancialSpaces(prisma, owner.id);
  const spaceId = `space_hh_${home.id}`;
  await prisma.financialSpaceMember.create({ data: { spaceId, userId: viewer.id, role: 'viewer' } });
  const institution = await prisma.institution.create({ data: { name: 'Bank', source: 'manual', ownerSpaceId: spaceId } });
  const account = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: spaceId, name: 'Joint', type: 'depository' } });
  for (const user of [owner, viewer]) {
    await prisma.session.create({ data: { sessionToken: `sess-${user.id}`, userId: user.id, expires: new Date(Date.now() + 60_000) } });
  }
  const ownerAccess = (await resolveRequestAccess(prisma, `sess-${owner.id}`, spaceId))!;
  const viewerAccess = (await resolveRequestAccess(prisma, `sess-${viewer.id}`, spaceId))!;
  return { owner, viewer, spaceId, account, ownerAccess, viewerAccess };
}

describe('role matrix: view-level members settling their own shares (integration)', () => {
  beforeEach(reset);

  it('lets a viewer participant settle and reopen their OWN share, nothing more', async () => {
    const { owner, viewer, spaceId, account, ownerAccess, viewerAccess } = await household();
    const dinner = await makeTx(account.id, -60, { merchant: 'Bistro' });
    const expense = await createSharedExpense(ownerAccess, {
      transactionId: dinner.id, shares: [{ userId: owner.id }, { userId: viewer.id }],
    });
    // Tests run unscoped, so backfill the spaceId the production guard injects.
    await prisma.sharedExpense.updateMany({ data: { spaceId } });
    const own = expense.shares.find(share => share.userId === viewer.id)!;
    const payers = expense.shares.find(share => share.userId === owner.id)!;

    const { raw, scoped } = scopedFor(viewerAccess);
    try {
      // Settle own share: settledAt lands, amount tampering is stripped.
      await scoped.expenseShare.update({
        where: { id: own.id }, data: { settledAt: new Date(), settledById: viewer.id, amount: 0.01 } as any,
      });
      const settled = await prisma.expenseShare.findUnique({ where: { id: own.id } });
      expect(settled!.settledAt).not.toBeNull();
      expect(settled!.amount).toBe(30);
      // Someone else's share stays out of reach.
      await expect(scoped.expenseShare.update({
        where: { id: payers.id }, data: { settledAt: new Date() },
      })).rejects.toBeTruthy();
      // And a viewer still cannot delete or create shares.
      expect((await scoped.expenseShare.deleteMany({})).count).toBe(0);
      await expect(scoped.expenseShare.create({
        data: { expenseId: expense.id, userId: viewer.id, amount: 1 },
      })).rejects.toBeTruthy();
    } finally { await raw.$disconnect(); }
  });

  it('service-level settle works for the participant and still blocks strangers', async () => {
    const { owner, viewer, account, ownerAccess, viewerAccess } = await household();
    const charge = await makeTx(account.id, -40, { merchant: 'Market' });
    const expense = await createSharedExpense(ownerAccess, {
      transactionId: charge.id, shares: [{ userId: owner.id }, { userId: viewer.id }],
    });
    const own = expense.shares.find(share => share.userId === viewer.id)!;

    // A member who is neither payer nor participant cannot settle.
    const bystander = await prisma.user.create({ data: { email: 'bystander@example.com' } });
    await prisma.financialSpaceMember.create({ data: { spaceId: viewerAccess.activeSpaceId, userId: bystander.id, role: 'manager' } });
    await prisma.session.create({ data: { sessionToken: `sess-${bystander.id}`, userId: bystander.id, expires: new Date(Date.now() + 60_000) } });
    const bystanderAccess = (await resolveRequestAccess(prisma, `sess-${bystander.id}`, viewerAccess.activeSpaceId))!;
    await expect(settleExpenseShare(bystanderAccess, own.id)).rejects.toMatchObject({ status: 403 });

    // The participant settles their own share without manage rights.
    await settleExpenseShare(viewerAccess, own.id);
    expect((await prisma.expenseShare.findUnique({ where: { id: own.id } }))!.settledAt).not.toBeNull();
    expect((await prisma.sharedExpense.findUnique({ where: { id: expense.id } }))!.status).toBe('settled');

    // But a participant cannot launder a settlement through an account they
    // do not manage.
    const inflow = await makeTx(account.id, 20);
    const second = await makeTx(account.id, -10, { merchant: 'Cafe' });
    const expense2 = await createSharedExpense(ownerAccess, {
      transactionId: second.id, shares: [{ userId: viewer.id }],
    });
    await expect(settleExpenseShare(viewerAccess, expense2.shares[0].id, { settlementTransactionId: inflow.id }))
      .rejects.toMatchObject({ status: 403 });
  });
});
