import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const categories = [
  ['Income', null, '#34d399'],
  ['Groceries', null, '#22c55e'],
  ['Restaurants', null, '#f97316'],
  ['Coffee', null, '#a16207'],
  ['Transport', null, '#3b82f6'],
  ['Gas', 'Transport', '#1d4ed8'],
  ['Rideshare', 'Transport', '#60a5fa'],
  ['Travel', null, '#8b5cf6'],
  ['Housing', null, '#64748b'],
  ['Utilities', null, '#94a3b8'],
  ['Internet', 'Utilities', '#94a3b8'],
  ['Phone', 'Utilities', '#94a3b8'],
  ['Subscriptions', null, '#e879f9'],
  ['Streaming', 'Subscriptions', '#d946ef'],
  ['SaaS', 'Subscriptions', '#a855f7'],
  ['Shopping', null, '#ec4899'],
  ['Health', null, '#06b6d4'],
  ['Fitness', 'Health', '#0891b2'],
  ['Entertainment', null, '#f43f5e'],
  ['Transfers', null, '#5a6280'],
  ['Fees', null, '#ef4444'],
  ['Cash', null, '#5a6280'],
  ['Other', null, '#5a6280'],
] as const;

async function main() {
  for (const [name, parent, color] of categories) {
    const existing = await prisma.category.findFirst({ where: { name, spaceId: null } });
    if (existing) await prisma.category.update({ where: { id: existing.id }, data: { parent: parent ?? null, color: color ?? null } });
    else await prisma.category.create({ data: { name, parent: parent ?? null, color: color ?? null } });
  }
  console.log(`Seeded ${categories.length} categories`);
}

main().finally(() => prisma.$disconnect());
