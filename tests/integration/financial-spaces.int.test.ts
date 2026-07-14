import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, reset } from './_fixtures';
import {
  applyFinancialScope,
  ensureUserFinancialSpaces,
  resolveRequestAccess,
} from '../../src/lib/financialAccess';
import {
  acceptPendingFinancialSpaceInvites,
  createStewardedSpace,
  grantDependentAutonomy,
  hasPendingFinancialSpaceInvite,
  inviteFinancialSpaceMember,
  updateSuccessionPlan,
} from '../../src/lib/financialSpaces';

describe('generational financial spaces (integration)', () => {
  beforeEach(reset);

  async function householdOwner() {
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
    const household = await prisma.household.create({ data: { name: 'Family' } });
    await prisma.householdMember.create({ data: { householdId: household.id, userId: owner.id, role: 'owner' } });
    await ensureUserFinancialSpaces(prisma, owner.id);
    return { owner, household, householdSpaceId: `space_hh_${household.id}`, personalSpaceId: `space_personal_${owner.id}` };
  }

  it('creates private and shared spaces without exposing one through the other', async () => {
    const { owner, householdSpaceId, personalSpaceId } = await householdOwner();
    const institution = await prisma.institution.create({ data: { name: 'Bank', source: 'manual', ownerSpaceId: householdSpaceId } });
    const shared = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: householdSpaceId, name: 'Shared checking', type: 'depository' } });
    const personal = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: personalSpaceId, name: 'Private checking', type: 'depository' } });
    const token = 'session-token';
    await prisma.session.create({ data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 60_000) } });

    const sharedAccess = await resolveRequestAccess(prisma, token, householdSpaceId);
    expect(sharedAccess?.summaryAccountIds).toEqual([shared.id]);
    const personalAccess = await resolveRequestAccess(prisma, token, personalSpaceId);
    expect(personalAccess?.summaryAccountIds).toEqual([personal.id]);

    const args = await applyFinancialScope('Transaction', 'findMany', { where: { pending: false } }, sharedAccess!);
    expect(args.where.AND).toContainEqual({ accountId: { in: [shared.id] } });
  });

  it('enforces scopes through real Prisma unique, compound-unique, create, and update operations', async () => {
    const { owner, householdSpaceId, personalSpaceId } = await householdOwner();
    const institution = await prisma.institution.create({ data: { name: 'Bank', source: 'manual', ownerSpaceId: householdSpaceId } });
    const shared = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: householdSpaceId, name: 'Shared', type: 'depository' } });
    const privateAccount = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: personalSpaceId, name: 'Private', type: 'depository' } });
    const privateTx = await prisma.transaction.create({ data: { accountId: privateAccount.id, hash: 'private-hash', date: new Date(), amount: -1, rawDescription: 'private' } });
    const token = 'scoped-session';
    await prisma.session.create({ data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 60_000) } });
    const access = (await resolveRequestAccess(prisma, token, householdSpaceId))!;
    const raw = new PrismaClient();
    const scoped = raw.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      return query(await applyFinancialScope(model, operation, args, access));
    } } } });
    try {
      expect((await scoped.bankAccount.findUnique({ where: { id: shared.id } }))?.id).toBe(shared.id);
      expect(await scoped.bankAccount.findUnique({ where: { id: privateAccount.id } })).toBeNull();
      await expect(scoped.transaction.update({ where: { id: privateTx.id }, data: { notes: 'leak' } })).rejects.toBeTruthy();
      const budget = await scoped.budget.create({ data: { scope: 'overall', monthly: 500 } });
      expect(budget.spaceId).toBe(householdSpaceId);
      const envelope = await scoped.envelope.upsert({
        where: { spaceId_monthYear_name: { spaceId: householdSpaceId, monthYear: '2026-07', name: 'Food' } },
        create: { monthYear: '2026-07', name: 'Food', allocated: 100 }, update: { allocated: 125 },
      });
      expect(envelope.spaceId).toBe(householdSpaceId);
    } finally { await raw.$disconnect(); }
  });

  it('caps a space grant by membership role and keeps document/export flags independent', async () => {
    const { owner, householdSpaceId, personalSpaceId } = await householdOwner();
    const viewer = await prisma.user.create({ data: { email: 'viewer@example.com' } });
    await ensureUserFinancialSpaces(prisma, viewer.id);
    await prisma.financialSpaceMember.create({ data: { spaceId: householdSpaceId, userId: viewer.id, role: 'viewer' } });
    const institution = await prisma.institution.create({ data: { name: 'Bank', source: 'manual', ownerSpaceId: personalSpaceId } });
    const account = await prisma.bankAccount.create({ data: { institutionId: institution.id, ownerSpaceId: personalSpaceId, name: 'Owner account', type: 'depository' } });
    await prisma.accountGrant.create({ data: { accountId: account.id, granteeSpaceId: householdSpaceId, accessLevel: 'manage', documentAccess: 'view', canExport: true, grantedById: owner.id } });
    const token = 'viewer-session';
    await prisma.session.create({ data: { sessionToken: token, userId: viewer.id, expires: new Date(Date.now() + 60_000) } });

    const access = await resolveRequestAccess(prisma, token, householdSpaceId);
    expect(access?.viewAccountIds).toContain(account.id);
    expect(access?.manageAccountIds).not.toContain(account.id);
    expect(access?.documentViewAccountIds).toContain(account.id);
    expect(access?.documentManageAccountIds).not.toContain(account.id);
    expect(access?.exportAccountIds).toContain(account.id);
  });

  it('accepts an email-bound advisor invite without making the advisor a household member', async () => {
    const { owner, householdSpaceId } = await householdOwner();
    await inviteFinancialSpaceMember(owner.id, householdSpaceId, { email: 'advisor@example.com', role: 'advisor', canManageDocuments: true, canExport: true });
    expect(await hasPendingFinancialSpaceInvite('advisor@example.com')).toBe(true);
    const advisor = await prisma.user.create({ data: { email: 'advisor@example.com' } });
    expect(await acceptPendingFinancialSpaceInvites(advisor.id, advisor.email)).toBe(1);
    const member = await prisma.financialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId: householdSpaceId, userId: advisor.id } } });
    expect(member).toMatchObject({ role: 'advisor', canManageDocuments: true, canExport: true });
    expect(await prisma.householdMember.count({ where: { userId: advisor.id } })).toBe(0);
  });

  it('prevents delegated inviters from escalating roles or re-delegating invite authority', async () => {
    const { householdSpaceId } = await householdOwner();
    const manager = await prisma.user.create({ data: { email: 'manager@example.com' } });
    await prisma.financialSpaceMember.create({
      data: { spaceId: householdSpaceId, userId: manager.id, role: 'manager', canManageDocuments: true, canInvite: true },
    });
    await expect(inviteFinancialSpaceMember(manager.id, householdSpaceId, {
      email: 'new-owner@example.com', role: 'owner',
    })).rejects.toMatchObject({ status: 403 });
    await expect(inviteFinancialSpaceMember(manager.id, householdSpaceId, {
      email: 'new-advisor@example.com', role: 'advisor', canInvite: true,
    })).rejects.toMatchObject({ status: 403 });
  });

  it('hands a stewarded ledger to its beneficiary without changing its identity or history', async () => {
    const { owner } = await householdOwner();
    const child = await prisma.user.create({ data: { email: 'child@example.com' } });
    const space = await createStewardedSpace(owner.id, { name: 'Child learning fund', beneficiaryEmail: child.email });
    await grantDependentAutonomy(owner.id, space.id, { beneficiaryUserId: child.id, guardianAccess: 'view' });
    const updated = await prisma.financialSpace.findUnique({ where: { id: space.id } });
    const childMember = await prisma.financialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId: space.id, userId: child.id } } });
    const guardian = await prisma.financialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId: space.id, userId: owner.id } } });
    expect(updated).toMatchObject({ id: space.id, kind: 'personal', beneficiaryUserId: child.id });
    expect(childMember?.role).toBe('owner');
    expect(guardian?.role).toBe('advisor');
  });

  it('will not grant autonomy to someone who was never designated as beneficiary', async () => {
    const { owner } = await householdOwner();
    const space = await createStewardedSpace(owner.id, { name: 'Future child ledger' });
    await expect(grantDependentAutonomy(owner.id, space.id, {
      beneficiaryUserId: owner.id, guardianAccess: 'none',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('requires a successor and a nonzero waiting period before succession can be enabled', async () => {
    const { owner, personalSpaceId } = await householdOwner();
    await expect(updateSuccessionPlan(owner.id, personalSpaceId, { enabled: true, successors: [] })).rejects.toMatchObject({ status: 400 });
    const plan = await updateSuccessionPlan(owner.id, personalSpaceId, {
      enabled: true, minimumApprovals: 3, waitingPeriodDays: 0,
      successors: [{ email: 'next@example.com' }], infrastructureChecklist: ['Restore host backups'],
    });
    expect(plan).toMatchObject({ enabled: true, minimumApprovals: 1, waitingPeriodDays: 1 });
  });
});
