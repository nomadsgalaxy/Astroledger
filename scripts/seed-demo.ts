// Demo data seeder. Populates a single fake user with realistic-looking
// transactions, accounts, subscriptions, tags, envelopes, and alerts so the
// hosted demo at astroledger.app has something to show on first load.
//
// ❗ Self-hosters: you almost certainly do NOT want to run this. It's only
// invoked for the astroledger.app demo deployment. Self-hosters get an
// empty database — connect a real bank, import CSVs, or add manual entries.
//
// Usage:
//   npm run seed:demo                # populate empty DB
//   npm run seed:demo -- --reset     # wipe demo data first, then seed
//
// Guards:
//   - Refuses to run if DATABASE_URL contains the word "prod"
//   - Refuses to run if any Transaction without source="demo" already exists
//     (so a self-hoster who runs it by accident on real data is protected)

import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const RESET = process.argv.includes('--reset');
const DEMO_USER_EMAIL = 'demo@astroledger.app';
const DEMO_USER_NAME  = 'Sam Demo';
const DEMO_INST_NAME  = 'Demo Bank';
const DEMO_TAG        = 'demo:seeded';      // every demo row gets this tag

type Row = {
  account: string;       // checking | savings | credit | brokerage
  date: string;          // YYYY-MM-DD
  amount: number;        // signed: negative = outflow, positive = inflow
  merchant: string;
  rawDescription: string;
  category?: string;
  tags?: string[];
  isTransfer?: boolean;
};

async function safetyChecks() {
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (/prod/i.test(dbUrl)) {
    throw new Error(`Refusing to seed: DATABASE_URL looks like prod (${dbUrl}). Aborting.`);
  }
  const totalTx = await prisma.transaction.count();
  const demoTagExists = await prisma.tag.findFirst({ where: { name: DEMO_TAG } });
  const demoRowsOnly = await prisma.transaction.count({
    where: { tags: { some: { name: DEMO_TAG } } },
  });
  if (totalTx > 0 && totalTx !== demoRowsOnly) {
    throw new Error(
      `Refusing to seed: database has ${totalTx} transactions, only ${demoRowsOnly} are demo-tagged. ` +
      `This looks like real data — run with --reset only if you're sure, AND --i-know on a forked seeder.`,
    );
  }
  if (RESET && demoTagExists) {
    console.log('--reset: clearing existing demo data first…');
    await prisma.transaction.deleteMany({ where: { tags: { some: { name: DEMO_TAG } } } });
    await prisma.subscription.deleteMany({ where: { tags: { some: { name: DEMO_TAG } } } });
    await prisma.envelope.deleteMany({});
    await prisma.spendingAlert.deleteMany({});
    await prisma.bankAccount.deleteMany({ where: { institution: { name: DEMO_INST_NAME } } });
    await prisma.institution.deleteMany({ where: { name: DEMO_INST_NAME } });
  }
}

// Generate ~6 months of fake activity ending today. Patterns are deterministic
// so re-running with --reset produces a stable demo (good for screenshots).
function generateRows(today: Date): Row[] {
  const rows: Row[] = [];
  const monthsBack = 6;
  const dayMs = 86_400_000;

  // Recurring monthly bills — these get detected as subscriptions.
  const monthlyBills: Array<[string, number, string, string?]> = [
    ['credit',    -89.00, 'AcmeFiber Internet',   'Internet'],
    ['checking', -1450.00, 'Skyline Apartments',   'Housing'],
    ['credit',    -15.99, 'Netflix',              'Streaming'],
    ['credit',    -12.99, 'Spotify Premium',      'Streaming'],
    ['credit',    -9.99,  'iCloud+ 200GB',        'SaaS'],
    ['credit',    -29.00, 'Anytime Fitness',      'Fitness'],
    ['credit',    -22.49, 'CellNet Wireless',     'Phone'],
    ['credit',    -54.99, 'Power & Light Co',     'Utilities'],
  ];

  // Biweekly paychecks (Fridays, looking back 6 months → 13 paychecks).
  for (let i = 0; i < 13; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i * 14);
    rows.push({
      account: 'checking',
      date: d.toISOString().slice(0, 10),
      amount: 2_847.32,
      merchant: 'Bluefin Robotics',
      rawDescription: 'ACH CREDIT BLUEFIN ROBOTICS PAYROLL',
      category: 'Income',
    });
  }

  // Monthly bills — anchor each to the 5th of each month within the window.
  for (let m = 0; m < monthsBack; m++) {
    for (const [account, amt, merchant, category] of monthlyBills) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 5));
      if (d > today) continue;
      rows.push({
        account, date: d.toISOString().slice(0, 10),
        amount: amt, merchant, rawDescription: merchant.toUpperCase(), category,
      });
    }
  }

  // Daily-life variable spend. Deterministic via a seeded RNG so the demo
  // looks the same every reset (helps with screenshots & sales demos).
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const merchants: Array<[string, [number, number], string, string]> = [
    // [merchant, [min,max] cents, category, raw description]
    ['Whole Foods Market', [25, 140], 'Groceries',   'WHOLE FOODS MKT #122'],
    ['Trader Joe\'s',     [18, 90],  'Groceries',   'TRADER JOE\'S #221'],
    ['Starbucks',         [4, 11],   'Coffee',      'STARBUCKS STORE'],
    ['Blue Bottle',       [5, 12],   'Coffee',      'BLUE BOTTLE COFFEE'],
    ['Uber',              [8, 35],   'Rideshare',   'UBER *TRIP'],
    ['Lyft',              [7, 28],   'Rideshare',   'LYFT *RIDE'],
    ['Shell',             [30, 70],  'Gas',         'SHELL OIL'],
    ['Chevron',           [28, 65],  'Gas',         'CHEVRON #088'],
    ['Sweetgreen',        [12, 18],  'Restaurants', 'SWEETGREEN'],
    ['Chipotle',          [11, 16],  'Restaurants', 'CHIPOTLE 0823'],
    ['Tartine Bakery',    [6, 22],   'Restaurants', 'TARTINE BAKERY'],
    ['Amazon',            [12, 220], 'Shopping',    'AMZN MKTP US*'],
    ['Target',            [25, 130], 'Shopping',    'TARGET 00012'],
    ['REI',               [40, 280], 'Shopping',    'REI #18'],
    ['DoorDash',          [18, 45],  'Restaurants', 'DOORDASH*'],
    ['Pharmacy Plus',     [8, 60],   'Health',      'PHARMACY PLUS #5'],
    ['Movie Palace',      [14, 32],  'Entertainment', 'MOVIE PALACE'],
  ];
  const days = monthsBack * 30;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    // 2-5 charges per day on average; weekends slightly more.
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const n = 2 + Math.floor(rand() * (isWeekend ? 5 : 4));
    for (let j = 0; j < n; j++) {
      const [merchant, [lo, hi], category, raw] = merchants[Math.floor(rand() * merchants.length)];
      const amount = -1 * Number((lo + rand() * (hi - lo)).toFixed(2));
      const account = rand() < 0.7 ? 'credit' : 'checking';
      rows.push({
        account, date: d.toISOString().slice(0, 10),
        amount: Number(amount), merchant, rawDescription: raw, category,
      });
    }
  }

  // Monthly auto-transfer checking → savings on the 1st.
  for (let m = 0; m < monthsBack; m++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
    if (d > today) continue;
    const date = d.toISOString().slice(0, 10);
    rows.push({ account: 'checking', date, amount: -500, merchant: 'Transfer to Savings',
      rawDescription: 'XFER TO SAVINGS', isTransfer: true });
    rows.push({ account: 'savings', date, amount: +500, merchant: 'Transfer from Checking',
      rawDescription: 'XFER FROM CHECKING', isTransfer: true });
  }

  // Monthly credit card payoff on the 20th.
  for (let m = 0; m < monthsBack; m++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 20));
    if (d > today) continue;
    const date = d.toISOString().slice(0, 10);
    rows.push({ account: 'checking', date, amount: -1200, merchant: 'Credit Card Payment',
      rawDescription: 'CREDIT CARD AUTOPAY', isTransfer: true });
    rows.push({ account: 'credit', date, amount: +1200, merchant: 'Payment Received',
      rawDescription: 'PAYMENT THANK YOU', isTransfer: true });
  }

  return rows;
}

async function main() {
  await safetyChecks();
  console.log('Seeding demo data…');

  // 1. Demo user (Auth.js User row) — gives the seeded data an owner so it
  //    looks logged-in on the demo page.
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: { email: DEMO_USER_EMAIL, name: DEMO_USER_NAME, isAdmin: false },
    update: { name: DEMO_USER_NAME },
  });
  const household = await prisma.household.upsert({
    where: { id: 'hh_default' }, create: { id: 'hh_default', name: 'Demo Household' }, update: {},
  });
  await prisma.householdMember.upsert({
    where: { householdId_userId: { householdId: household.id, userId: user.id } },
    create: { householdId: household.id, userId: user.id, role: 'owner' }, update: { role: 'owner' },
  });
  const spaceId = `space_hh_${household.id}`;
  await prisma.financialSpace.upsert({
    where: { id: spaceId },
    create: { id: spaceId, name: 'Demo Household Finances', kind: 'household', householdId: household.id, createdById: user.id },
    update: { name: 'Demo Household Finances' },
  });
  await prisma.financialSpaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId: user.id } },
    create: { spaceId, userId: user.id, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
    update: { role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
  });
  const personalSpaceId = `space_personal_${user.id}`;
  await prisma.financialSpace.upsert({
    where: { id: personalSpaceId },
    create: { id: personalSpaceId, name: `${DEMO_USER_NAME}'s Finances`, kind: 'personal', beneficiaryUserId: user.id, createdById: user.id },
    update: {},
  });
  await prisma.financialSpaceMember.upsert({
    where: { spaceId_userId: { spaceId: personalSpaceId, userId: user.id } },
    create: { spaceId: personalSpaceId, userId: user.id, role: 'owner', canManageDocuments: true, canExport: true, canInvite: true },
    update: {},
  });

  // 2. Institution + accounts. Single fake bank to keep the demo focused.
  const inst = await prisma.institution.upsert({
    where: { plaidItemId: 'demo-item-001' },
    create: { name: DEMO_INST_NAME, source: 'manual', plaidItemId: 'demo-item-001', ownerSpaceId: spaceId },
    update: { name: DEMO_INST_NAME, ownerSpaceId: spaceId },
  });

  type AcctKey = 'checking' | 'savings' | 'credit' | 'brokerage';
  const acctSpec: Record<AcctKey, { name: string; type: string; subtype: string; mask: string; kind: string; balance: number }> = {
    checking:  { name: 'Everyday Checking',  type: 'depository', subtype: 'checking', mask: '4421', kind: 'checking',         balance:  4_182.47 },
    savings:   { name: 'High-Yield Savings', type: 'depository', subtype: 'savings',  mask: '7720', kind: 'savings_short',    balance: 14_900.00 },
    credit:    { name: 'Cashback Card',      type: 'credit',     subtype: 'credit',   mask: '5018', kind: 'credit',           balance: -1_063.18 },
    brokerage: { name: 'Index Brokerage',    type: 'investment', subtype: 'brokerage',mask: '9943', kind: 'investment',       balance: 38_650.00 },
  };
  const accounts: Record<AcctKey, string> = {} as any;
  for (const key of Object.keys(acctSpec) as AcctKey[]) {
    const s = acctSpec[key];
    const a = await prisma.bankAccount.upsert({
      where: { plaidAccountId: `demo-${key}` },
      create: {
        institutionId: inst.id, plaidAccountId: `demo-${key}`, ownerSpaceId: spaceId,
        name: s.name, type: s.type, subtype: s.subtype, mask: s.mask, kind: s.kind,
        currency: 'USD', balance: s.balance, balanceAsOf: new Date(),
      },
      update: { balance: s.balance, balanceAsOf: new Date(), ownerSpaceId: spaceId },
    });
    accounts[key] = a.id;
  }

  // 3. Demo bookkeeping tag. Used as a stable marker so we can identify (and
  //    safely re-seed) demo rows. parentId is null + Prisma's compound unique
  //    on (parentId, name) treats NULLs as distinct, so use find-or-create.
  let demoTag = await prisma.tag.findFirst({ where: { name: DEMO_TAG, parentId: null } });
  if (!demoTag) {
    demoTag = await prisma.tag.create({ data: { name: DEMO_TAG, color: '#888', kind: 'secondary' } });
  }

  // 4. Categories — seed.ts (the main seed) handles these; we just look them up.
  const categoryByName = new Map<string, string>();
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  for (const c of cats) categoryByName.set(c.name, c.id);

  // 5. Transactions.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = generateRows(today);
  console.log(`Inserting ${rows.length} transactions…`);
  let inserted = 0;
  for (const r of rows) {
    const accountId = accounts[r.account as AcctKey];
    const dateObj = new Date(r.date + 'T12:00:00Z');
    const hashSeed = `${accountId}|${r.date}|${r.amount}|${r.rawDescription}|demo`;
    const hash = createHash('sha256').update(hashSeed).digest('hex');
    try {
      await prisma.transaction.create({
        data: {
          accountId, hash,
          date: dateObj, amount: r.amount,
          rawDescription: r.rawDescription, merchant: r.merchant,
          categoryId: r.category ? categoryByName.get(r.category) ?? null : null,
          isTransfer: r.isTransfer ?? false,
          tags: { connect: [{ id: demoTag.id }] },
        },
      });
      inserted++;
    } catch (e: any) {
      if (!String(e.message).includes('Unique constraint')) {
        console.warn(`Skipped row: ${e.message}`);
      }
    }
  }
  console.log(`Inserted ${inserted} transactions.`);

  // 6. A couple of envelopes for the current month — the visitor sees them
  //    rendered as progress bars on /envelopes.
  const ymNow = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  const envelopes: Array<[string, number]> = [
    ['Groceries', 450], ['Restaurants', 250], ['Coffee', 60], ['Shopping', 200],
  ];
  for (const [name, allocated] of envelopes) {
    const catId = categoryByName.get(name);
    await prisma.envelope.upsert({
      where: { spaceId_monthYear_name: { spaceId, monthYear: ymNow, name } },
      create: { spaceId, monthYear: ymNow, name, allocated, scope: 'category', categoryId: catId ?? null },
      update: { allocated },
    });
  }

  // 7. A couple of spending alerts — caps that visitors will see in /alerts.
  const alertCats: Array<[string, number]> = [['Restaurants', 300], ['Shopping', 400]];
  for (const [catName, cap] of alertCats) {
    const catId = categoryByName.get(catName);
    if (!catId) continue;
    const existing = await prisma.spendingAlert.findFirst({ where: { categoryId: catId } });
    if (existing) continue;
    await prisma.spendingAlert.create({
      data: { scope: 'category', categoryId: catId, monthlyCap: cap, warnPct: 0.8, enabled: true },
    });
  }

  // Direct Prisma seed operations do not run through the request access
  // extension, so attach every generated planning row to the demo space.
  await Promise.all([
    prisma.category.updateMany({ where: { spaceId: null }, data: { spaceId } }),
    prisma.tag.updateMany({ where: { spaceId: null }, data: { spaceId } }),
    prisma.subscription.updateMany({ where: { spaceId: null }, data: { spaceId } }),
    prisma.spendingAlert.updateMany({ where: { spaceId: null }, data: { spaceId } }),
    prisma.recommendation.updateMany({ where: { spaceId: null }, data: { spaceId } }),
    prisma.order.updateMany({ where: { spaceId: null }, data: { spaceId } }),
  ]);

  console.log(`✓ Demo seeded for user ${user.email}.`);
  await prisma.$disconnect();

  // Snapshot the freshly-seeded DB to prisma/sandboxes/_seed.db. Per-session
  // sandboxes (see src/lib/demoSandbox.ts) clone from this file on first hit.
  // Doing it from a Node child + dynamic import keeps the seeder itself
  // SQLite-agnostic — fs.copyFile is all we need.
  try {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const sandboxDir = path.join(process.cwd(), 'prisma', 'sandboxes');
    const seedSnapshot = path.join(sandboxDir, '_seed.db');
    const liveDb = path.join(process.cwd(), 'prisma', 'demo.db');
    await fs.mkdir(sandboxDir, { recursive: true });
    // Wipe any existing per-visitor sandboxes — they'd be stale relative to
    // the new snapshot (different rows, possibly different schema migrations).
    const entries = await fs.readdir(sandboxDir).catch(() => [] as string[]);
    for (const f of entries) {
      if (f === '_seed.db' || !f.endsWith('.db')) continue;
      await fs.unlink(path.join(sandboxDir, f)).catch(() => {});
    }
    await fs.copyFile(liveDb, seedSnapshot);
    console.log(`✓ Snapshot written to prisma/sandboxes/_seed.db`);
  } catch (e: any) {
    console.warn('seed snapshot failed (sandboxes will fall back to demo.db):', e.message);
  }
}

main().catch(async (e) => {
  console.error('Seed failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
