// Seed script for the multi-user e2e gate, run by the webServer command in
// playwright.multiuser.config.ts BEFORE `next dev` starts (Playwright launches
// the web server before globalSetup, so seeding must happen in the command
// chain). Reads DATABASE_URL from the environment the config sets.
//
// Creates four authenticated users and the fixtures the specs exercise:
//   owner    — owns the household space and both bank accounts
//   partner  — household manager
//   helper   — outside the household; holds one active and one expired grant
//   advisor  — nominated successor with an approved, past-wait request
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SESSIONS } from './sessions';

const DB_URL = process.env.DATABASE_URL!;
if (!DB_URL?.includes('.e2e-multiuser')) {
  throw new Error(`Refusing to seed: DATABASE_URL is "${DB_URL}", not the .e2e-multiuser scratch DB`);
}
const DB_FILE = DB_URL.replace(/^file:/, '');

async function main() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(DB_FILE + suffix, { force: true });
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  try {
    const expires = new Date(Date.now() + 86_400_000);
    const mkUser = async (key: keyof typeof SESSIONS, name: string) => {
      const user = await prisma.user.create({ data: { email: `${key}@e2e.test`, name, emailVerified: new Date() } });
      await prisma.session.create({ data: { sessionToken: SESSIONS[key], userId: user.id, expires } });
      return user;
    };
    const owner = await mkUser('owner', 'E2E Owner');
    const partner = await mkUser('partner', 'E2E Partner');
    const helper = await mkUser('helper', 'E2E Helper');
    const advisor = await mkUser('advisor', 'E2E Advisor');
    await mkUser('newbie', 'E2E Newbie'); // deliberately no household/space rows

    const household = await prisma.household.create({ data: { name: 'E2E Family' } });
    await prisma.householdMember.createMany({
      data: [
        { householdId: household.id, userId: owner.id, role: 'owner' },
        { householdId: household.id, userId: partner.id, role: 'member' },
      ],
    });

    // Mirror what ensureUserFinancialSpaces would create so seeded rows that
    // FK onto FinancialSpace (succession plan) can exist up front. The app's
    // self-heal upserts are no-ops against these ids.
    const householdSpaceId = `space_hh_${household.id}`;
    await prisma.financialSpace.create({
      data: { id: householdSpaceId, name: 'E2E Family Finances', kind: 'household', householdId: household.id, createdById: owner.id },
    });
    await prisma.financialSpaceMember.createMany({
      data: [
        { spaceId: householdSpaceId, userId: owner.id, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
        { spaceId: householdSpaceId, userId: partner.id, role: 'manager', canManageDocuments: true, canExport: true, canInvite: false },
        { spaceId: householdSpaceId, userId: advisor.id, role: 'successor' },
      ],
    });

    const bank = await prisma.institution.create({ data: { name: 'E2E Bank', source: 'manual', ownerSpaceId: householdSpaceId } });
    const checking = await prisma.bankAccount.create({
      data: { institutionId: bank.id, ownerSpaceId: householdSpaceId, name: 'Shared checking', type: 'depository', balance: 1200 },
    });
    const savings = await prisma.bankAccount.create({
      data: { institutionId: bank.id, ownerSpaceId: householdSpaceId, name: 'Shared savings', type: 'depository', balance: 8000 },
    });
    await prisma.transaction.create({
      data: { accountId: checking.id, hash: 'e2e-tx-1', date: new Date(), amount: -42.5, rawDescription: 'E2E Grocery' },
    });

    // helper: one live grant (view, no export) and one already-expired grant.
    await prisma.accountGrant.createMany({
      data: [
        { accountId: checking.id, granteeUserId: helper.id, accessLevel: 'view', documentAccess: 'none', grantedById: owner.id },
        { accountId: savings.id, granteeUserId: helper.id, accessLevel: 'view', grantedById: owner.id, expiresAt: new Date(Date.now() - 86_400_000) },
      ],
    });

    // advisor: accepted successor with an approved request whose waiting
    // period has already elapsed — the spec executes it through the UI.
    const plan = await prisma.spaceSuccessionPlan.create({
      data: { spaceId: householdSpaceId, enabled: true, minimumApprovals: 1, waitingPeriodDays: 1 },
    });
    await prisma.spaceSuccessor.create({
      data: { planId: plan.id, email: advisor.email, userId: advisor.id, status: 'accepted', acceptedAt: new Date() },
    });
    const request = await prisma.successionRequest.create({
      data: { planId: plan.id, requestedById: advisor.id, status: 'approved', executeAfter: new Date(Date.now() - 3_600_000) },
    });
    await prisma.successionApproval.create({ data: { requestId: request.id, userId: advisor.id, decision: 'approve' } });
    console.log('[e2e-multiuser] seeded scratch database');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
