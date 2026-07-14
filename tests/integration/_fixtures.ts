// Shared fixtures for the integration suite. All tests run in one fork against
// one scratch DB, so each test resets the tables it touches first.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma';

// SAFETY GUARD: these fixtures DELETE data. They must only ever run against the
// throwaway scratch DB. If this module is imported with DATABASE_URL pointing
// anywhere else (e.g. integration tests accidentally picked up by the unit
// config, which once wiped dev.db), fail loudly at import instead of nuking a
// real database.
if (!String(process.env.DATABASE_URL ?? '').includes('.test-integration')) {
  throw new Error(
    `[integration fixtures] Refusing to run: DATABASE_URL is "${process.env.DATABASE_URL}", not the .test-integration scratch DB. ` +
    `Run via "npm run test:integration" (which sets up the scratch DB), never the unit gate.`,
  );
}

/** Wipe the transactional tables (children → parents) for an isolated test. */
export async function reset() {
  // Order matters for FK constraints; deleteMany cascades where configured.
  await prisma.spaceAuditEvent.deleteMany({});
  await prisma.spaceNotification.deleteMany({});
  await prisma.sharedExpense.deleteMany({});
  await prisma.allowanceRule.deleteMany({});
  await prisma.choreTask.deleteMany({});
  await prisma.successionApproval.deleteMany({});
  await prisma.successionRequest.deleteMany({});
  await prisma.spaceSuccessor.deleteMany({});
  await prisma.spaceSuccessionPlan.deleteMany({});
  await prisma.financialDocument.deleteMany({});
  await prisma.accountGrant.deleteMany({});
  await prisma.financialSpaceInvite.deleteMany({});
  await prisma.financialSpaceMember.deleteMany({});
  await prisma.scenarioAdjustment.deleteMany({});
  await prisma.scenario.deleteMany({});
  await prisma.schedule.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.billOccurrence.deleteMany({});
  await prisma.householdInvite.deleteMany({});
  await prisma.householdMember.deleteMany({});
  await prisma.household.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.forecastPoint.deleteMany({});
  await prisma.forecast.deleteMany({});
  await prisma.envelope.deleteMany({});
  await prisma.investmentTxn.deleteMany({});
  await prisma.holding.deleteMany({});
  await prisma.securityPrice.deleteMany({});
  await prisma.security.deleteMany({});
  await prisma.fxRate.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.institution.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.financialSpace.deleteMany({});
}

export async function makeInstitution(name = 'Test Bank', source = 'manual') {
  return prisma.institution.create({ data: { name, source } });
}

export async function makeAccount(institutionId: string, name = 'Checking', extra: Record<string, unknown> = {}) {
  return prisma.bankAccount.create({
    data: { institutionId, name, type: 'depository', currency: 'USD', ...extra },
  });
}

/** Create a transaction with sensible defaults; amount<0 = outflow, >0 = inflow. */
export async function makeTx(accountId: string, amount: number, extra: Record<string, unknown> = {}) {
  const date = (extra.date as Date) ?? new Date('2026-05-15');
  return prisma.transaction.create({
    data: {
      accountId,
      hash: `itest-${randomUUID()}`,
      date,
      amount,
      rawDescription: (extra.rawDescription as string) ?? 'tx',
      ...extra,
    },
  });
}

export { prisma };
