import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, reset } from './_fixtures';
import { applyFinancialScope, ensureUserFinancialSpaces, resolveRequestAccess } from '../../src/lib/financialAccess';
import { createStewardedSpace } from '../../src/lib/financialSpaces';
import {
  claimChore, createChore, decideAllowancePayout, decideChore,
  processDueAllowances, upsertAllowanceRule,
} from '../../src/lib/allowances';

async function stewarded() {
  const guardian = await prisma.user.create({ data: { email: 'guardian@example.com', name: 'Guardian' } });
  await ensureUserFinancialSpaces(prisma, guardian.id);
  const child = await prisma.user.create({ data: { email: 'child@example.com', name: 'Child' } });
  const space = await createStewardedSpace(guardian.id, { name: 'Child fund', beneficiaryEmail: child.email });
  const institution = await prisma.institution.create({ data: { name: 'Wallet', source: 'manual', ownerSpaceId: space.id } });
  const account = await prisma.bankAccount.create({
    data: { institutionId: institution.id, ownerSpaceId: space.id, name: 'Pocket money', type: 'wallet', balance: 0 },
  });
  const guardianToken = `sess-${guardian.id}`;
  await prisma.session.create({ data: { sessionToken: guardianToken, userId: guardian.id, expires: new Date(Date.now() + 60_000) } });
  const childToken = `sess-${child.id}`;
  await prisma.session.create({ data: { sessionToken: childToken, userId: child.id, expires: new Date(Date.now() + 60_000) } });
  const guardianAccess = (await resolveRequestAccess(prisma, guardianToken, space.id))!;
  const childAccess = (await resolveRequestAccess(prisma, childToken, space.id))!;
  return { guardian, child, space, account, guardianAccess, childAccess };
}

describe('allowances and chores (integration)', () => {
  beforeEach(reset);

  it('auto-approve allowances materialize into real transactions exactly once', async () => {
    const { child, account, guardianAccess } = await stewarded();
    await upsertAllowanceRule(guardianAccess, {
      name: 'Weekly allowance', amount: 10, cadenceDays: 7,
      nextDate: new Date(Date.now() - 15 * 86_400_000).toISOString(), // ~2 periods overdue
      accountId: account.id, autoApprove: true,
    });
    const materialized = await processDueAllowances(guardianAccess);
    expect(materialized).toBe(3); // day -15, -8, -1
    expect(await prisma.transaction.count({ where: { accountId: account.id, hash: { startsWith: 'allowance:' } } })).toBe(3);
    expect((await prisma.bankAccount.findUnique({ where: { id: account.id } }))!.balance).toBeCloseTo(30, 2);
    expect(await prisma.spaceNotification.count({ where: { userId: child.id, kind: 'allowance' } })).toBe(3);
    // Re-processing is idempotent and the rule's nextDate moved into the future.
    expect(await processDueAllowances(guardianAccess)).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId: account.id, hash: { startsWith: 'allowance:' } } })).toBe(3);
    const rule = await prisma.allowanceRule.findFirst({});
    expect(rule!.nextDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('manual allowances wait for a guardian decision; a dependent visit never pays', async () => {
    const { account, guardianAccess, childAccess } = await stewarded();
    await upsertAllowanceRule(guardianAccess, {
      name: 'Monthly top-up', amount: 25, cadenceDays: 30,
      nextDate: new Date(Date.now() - 60_000).toISOString(), accountId: account.id,
    });
    expect(await processDueAllowances(childAccess)).toBe(0); // view-only ceiling
    await processDueAllowances(guardianAccess);
    const pending = await prisma.allowancePayout.findFirst({ where: { status: 'pending' } });
    expect(pending).not.toBeNull();
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);

    await expect(decideAllowancePayout(childAccess, pending!.id, 'approve')).rejects.toMatchObject({ status: 403 });
    await decideAllowancePayout(guardianAccess, pending!.id, 'approve');
    expect((await prisma.allowancePayout.findUnique({ where: { id: pending!.id } }))!.status).toBe('paid');
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(1);
  });

  it('rejecting a payout records history without moving money', async () => {
    const { account, guardianAccess } = await stewarded();
    await upsertAllowanceRule(guardianAccess, {
      name: 'Trial', amount: 5, cadenceDays: 7,
      nextDate: new Date(Date.now() - 60_000).toISOString(), accountId: account.id,
    });
    await processDueAllowances(guardianAccess);
    const pending = await prisma.allowancePayout.findFirst({ where: { status: 'pending' } });
    await decideAllowancePayout(guardianAccess, pending!.id, 'reject');
    expect((await prisma.allowancePayout.findUnique({ where: { id: pending!.id } }))!.status).toBe('rejected');
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.spaceAuditEvent.count({ where: { action: 'allowance.reject' } })).toBe(1);
  });

  it('runs the chore loop: assign, claim, approve, pay', async () => {
    const { guardian, child, account, guardianAccess, childAccess } = await stewarded();
    const chore = await createChore(guardianAccess, { name: 'Mow the lawn', reward: 12.5, assigneeUserId: child.id });
    expect(await prisma.spaceNotification.count({ where: { userId: child.id, kind: 'chore' } })).toBe(1);

    await claimChore(childAccess, chore.id);
    expect((await prisma.choreTask.findUnique({ where: { id: chore.id } }))!.status).toBe('done_pending');
    expect(await prisma.spaceNotification.count({ where: { userId: guardian.id, kind: 'chore' } })).toBe(1);

    await expect(decideChore(childAccess, chore.id, 'approve', account.id)).rejects.toMatchObject({ status: 403 });
    await decideChore(guardianAccess, chore.id, 'approve', account.id);
    const paid = await prisma.choreTask.findUnique({ where: { id: chore.id } });
    expect(paid!.status).toBe('paid');
    expect(paid!.transactionId).toBeTruthy();
    expect((await prisma.bankAccount.findUnique({ where: { id: account.id } }))!.balance).toBeCloseTo(12.5, 2);
    expect(await prisma.spaceNotification.count({ where: { userId: child.id, kind: 'chore' } })).toBe(2);
  });

  it('a rejected chore reopens for another try and pays nothing', async () => {
    const { child, account, guardianAccess, childAccess } = await stewarded();
    const chore = await createChore(guardianAccess, { name: 'Clean room', reward: 3, assigneeUserId: child.id, accountId: account.id });
    await claimChore(childAccess, chore.id);
    await decideChore(guardianAccess, chore.id, 'reject');
    const after = await prisma.choreTask.findUnique({ where: { id: chore.id } });
    expect(after!.status).toBe('open');
    expect(after!.completedAt).toBeNull();
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('the Prisma guard lets a dependent mark only their own chore done and freezes the reward', async () => {
    const { child, space, guardianAccess, childAccess } = await stewarded();
    const own = await createChore(guardianAccess, { name: 'Homework', reward: 4, assigneeUserId: child.id });
    const other = await createChore(guardianAccess, { name: 'Guardian-only task', reward: 4 });
    await prisma.choreTask.update({ where: { id: other.id }, data: { assigneeUserId: guardianAccess.userId } });
    // Tests run unscoped, so backfill the spaceId the production guard injects.
    await prisma.choreTask.updateMany({ data: { spaceId: space.id } });

    const raw = new PrismaClient();
    const scoped = raw.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      return query(await applyFinancialScope(model, operation, args, childAccess));
    } } } });
    try {
      // Reward and name changes are stripped; status flip on own chore works.
      await scoped.choreTask.update({ where: { id: own.id }, data: { status: 'done_pending', reward: 9999, name: 'hacked' } as any });
      const updated = await prisma.choreTask.findUnique({ where: { id: own.id } });
      expect(updated!.status).toBe('done_pending');
      expect(updated!.reward).toBe(4);
      expect(updated!.name).toBe('Homework');
      // Someone else's chore is out of reach entirely.
      await expect(scoped.choreTask.update({ where: { id: other.id }, data: { status: 'done_pending' } })).rejects.toBeTruthy();
      // Creating or deleting chores requires manage rights.
      await expect(scoped.choreTask.create({ data: { name: 'forged', reward: 1, spaceId: space.id } })).rejects.toBeTruthy();
      expect((await scoped.choreTask.deleteMany({})).count).toBe(0);
    } finally { await raw.$disconnect(); }
  });
});
