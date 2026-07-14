import { prisma } from '@/lib/prisma';
import BudgetsClient from '../../_components/BudgetsClient';
import { getRange } from '@/lib/timeRange.server';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, string> = {
  Groceries: '🛒', Restaurants: '🍽️', Coffee: '☕', Transport: '🚇', Gas: '⛽',
  Rideshare: '🚖', Travel: '✈️', Housing: '🏠', Utilities: '⚡', Internet: '📶',
  Phone: '📱', Subscriptions: '🔁', Streaming: '🎬', SaaS: '⚙', Shopping: '🛍️',
  Health: '⚕', Fitness: '🏋️', Entertainment: '🎮', Transfers: '↔', Fees: '⚠',
  Cash: '💵', Income: '💰', Other: '✦',
};

export default async function BudgetsPage() {
  const range = await getRange();

  const [categories, budgets, windowTx] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    prisma.budget.findMany(),
    prisma.transaction.findMany({
      where: { date: { gte: range.since }, amount: { lt: 0 }, isTransfer: false },
      select: { amount: true, category: { select: { name: true } } },
    }),
  ]);

  // Sum spend in the window per category
  const spendByCat = new Map<string, number>();
  for (const t of windowTx) {
    const k = t.category?.name ?? 'Other';
    spendByCat.set(k, (spendByCat.get(k) ?? 0) + Math.abs(t.amount));
  }

  // Map category → configured monthly cap
  const budgetByCat = new Map<string, number>();
  for (const b of budgets) {
    if (b.scope === 'category' && b.categoryId) {
      const cat = categories.find(c => c.id === b.categoryId);
      if (cat) budgetByCat.set(cat.name, b.monthly);
    }
  }

  // Pro-rate the monthly cap by window length (30d = full month, 7d ≈ ¼, 90d = 3×, …)
  const capFactor = range.days / 30;

  const rows = categories
    .filter(c => c.name !== 'Income' && c.name !== 'Transfers')
    .map(c => {
      const monthlyCap = budgetByCat.get(c.name) ?? 0;
      return {
        id: c.id,
        name: c.name,
        icon: ICONS[c.name] ?? '✦',
        cap: monthlyCap * capFactor,
        spent: spendByCat.get(c.name) ?? 0,
        color: c.color ?? null,
      };
    })
    .filter(r => r.cap > 0 || r.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  return (
    <BudgetsClient
      rows={rows}
      rangeLabel={range.label}
      rangeDays={range.days}
    />
  );
}
