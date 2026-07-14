import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, reset } from './_fixtures';
import { ensureUserFinancialSpaces, resolveRequestAccess } from '../../src/lib/financialAccess';
import { moveAccountToSpace, moveConnectionToSpace } from '../../src/lib/financialSpaces';

async function setup() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner' } });
  const home = await prisma.household.create({ data: { name: 'Home' } });
  await prisma.householdMember.create({ data: { householdId: home.id, userId: owner.id, role: 'owner' } });
  await ensureUserFinancialSpaces(prisma, owner.id);
  const householdSpaceId = `space_hh_${home.id}`;
  const personalSpaceId = `space_personal_${owner.id}`;
  const bank = await prisma.institution.create({
    data: { name: 'Live Bank', source: 'plaid', ownerSpaceId: householdSpaceId },
  });
  // Set the credential via SQL: the encrypt extension needs an unlocked vault,
  // and the move logic only cares that accessToken IS NOT NULL.
  await prisma.$executeRaw`UPDATE Institution SET accessToken = 'v1:dummy' WHERE id = ${bank.id}`;
  const checking = await prisma.bankAccount.create({ data: { institutionId: bank.id, ownerSpaceId: householdSpaceId, name: 'Checking', type: 'depository' } });
  const savings = await prisma.bankAccount.create({ data: { institutionId: bank.id, ownerSpaceId: householdSpaceId, name: 'Savings', type: 'depository' } });
  const token = `sess-${owner.id}`;
  await prisma.session.create({ data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 60_000) } });
  const access = (await resolveRequestAccess(prisma, token, householdSpaceId))!;
  return { owner, householdSpaceId, personalSpaceId, bank, checking, savings, access };
}

describe('whole-connection account moves (integration)', () => {
  beforeEach(reset);

  it('still refuses to split a credentialed connection one account at a time', async () => {
    const { owner, personalSpaceId, checking, access } = await setup();
    await expect(moveAccountToSpace(owner.id, checking.id, personalSpaceId, access))
      .rejects.toMatchObject({ status: 409 });
  });

  it('moves every account plus the institution together, with audit on both spaces', async () => {
    const { owner, householdSpaceId, personalSpaceId, bank, checking, savings, access } = await setup();
    await moveConnectionToSpace(owner.id, bank.id, personalSpaceId, access);
    const [movedChecking, movedSavings, movedBank] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: checking.id } }),
      prisma.bankAccount.findUnique({ where: { id: savings.id } }),
      prisma.institution.findUnique({ where: { id: bank.id } }),
    ]);
    expect(movedChecking!.ownerSpaceId).toBe(personalSpaceId);
    expect(movedSavings!.ownerSpaceId).toBe(personalSpaceId);
    expect(movedBank!.ownerSpaceId).toBe(personalSpaceId);
    expect(await prisma.spaceAuditEvent.count({ where: { spaceId: householdSpaceId, action: 'connection.move' } })).toBe(1);
    expect(await prisma.spaceAuditEvent.count({ where: { spaceId: personalSpaceId, action: 'connection.move' } })).toBe(1);
  });

  it('requires owning the target space and every account on the connection', async () => {
    const { owner, householdSpaceId, personalSpaceId, bank, savings, access } = await setup();
    // Manager (not owner) of the target space cannot receive the connection.
    const partner = await prisma.user.create({ data: { email: 'partner@example.com' } });
    await prisma.financialSpaceMember.create({ data: { spaceId: householdSpaceId, userId: partner.id, role: 'manager' } });
    const partnerToken = `sess-${partner.id}`;
    await prisma.session.create({ data: { sessionToken: partnerToken, userId: partner.id, expires: new Date(Date.now() + 60_000) } });
    const partnerAccess = (await resolveRequestAccess(prisma, partnerToken, householdSpaceId))!;
    await expect(moveConnectionToSpace(partner.id, bank.id, personalSpaceId, partnerAccess))
      .rejects.toMatchObject({ status: 403 });

    // If one sibling lives in a space the actor does not own here, refuse.
    await prisma.$executeRaw`UPDATE BankAccount SET ownerSpaceId = 'space_elsewhere' WHERE id = ${savings.id}`;
    const refreshed = (await resolveRequestAccess(prisma, `sess-${owner.id}`, householdSpaceId))!;
    await expect(moveConnectionToSpace(owner.id, bank.id, personalSpaceId, refreshed))
      .rejects.toMatchObject({ status: 403 });
  });
});
