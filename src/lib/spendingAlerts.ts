import { prisma } from './prisma';

export type AlertProgress = {
  id: string;
  scope: 'tag' | 'category' | 'overall';
  tagId: string | null;
  categoryId: string | null;
  label: string;
  monthlyCap: number;
  warnPct: number;
  enabled: boolean;
  spentThisMonth: number;
  pct: number;             // 0..N (can exceed 1 when over budget)
  state: 'ok' | 'warn' | 'over';
};

// Compute spending vs cap for every enabled alert. Tag-scoped alerts also
// include child tags' spending - same convention as the rest of Astroledger.
export async function listAlertProgress(opts: { monthOffset?: number } = {}): Promise<AlertProgress[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (opts.monthOffset ?? 0), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (opts.monthOffset ?? 0) + 1, 1));

  const alerts = await prisma.spendingAlert.findMany({ where: { enabled: true } });
  if (!alerts.length) return [];

  // Pre-fetch all this-month outflows once.
  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: start, lt: end },
      amount: { lt: 0 },
      isTransfer: false,
      isSplit: false,                            // parents excluded; splits flow through children
    },
    include: { tags: { select: { id: true, parentId: true, name: true } }, category: { select: { id: true, name: true } } },
  });

  // Tag closure: given a tagId, return the set of {self + descendants}.
  const allTags = await prisma.tag.findMany({ select: { id: true, parentId: true, name: true } });
  const childrenOf = new Map<string, string[]>();
  for (const t of allTags) {
    if (!t.parentId) continue;
    if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
    childrenOf.get(t.parentId)!.push(t.id);
  }
  function closure(rootId: string): Set<string> {
    const set = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of childrenOf.get(cur) ?? []) {
        if (!set.has(c)) { set.add(c); stack.push(c); }
      }
    }
    return set;
  }

  // Pre-resolve scope labels.
  const tagNameById = new Map(allTags.map(t => [t.id, t.name]));
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  const catNameById = new Map(cats.map(c => [c.id, c.name]));

  return alerts.map(a => {
    const tagSet = a.scope === 'tag' && a.tagId ? closure(a.tagId) : null;
    let spent = 0;
    for (const t of txs) {
      if (a.scope === 'tag' && tagSet) {
        if (!t.tags.some(tg => tagSet.has(tg.id))) continue;
      } else if (a.scope === 'category' && a.categoryId) {
        if (t.category?.id !== a.categoryId) continue;
      }
      spent += Math.abs(t.amount);
    }
    const label = a.scope === 'overall' ? 'Overall'
      : a.scope === 'tag' && a.tagId ? (tagNameById.get(a.tagId) ?? '?')
      : a.scope === 'category' && a.categoryId ? (catNameById.get(a.categoryId) ?? '?')
      : ' - ';
    const pct = a.monthlyCap > 0 ? spent / a.monthlyCap : 0;
    const state: AlertProgress['state'] = pct >= 1 ? 'over' : pct >= a.warnPct ? 'warn' : 'ok';
    return {
      id: a.id,
      scope: a.scope as AlertProgress['scope'],
      tagId: a.tagId,
      categoryId: a.categoryId,
      label,
      monthlyCap: a.monthlyCap,
      warnPct: a.warnPct,
      enabled: a.enabled,
      spentThisMonth: spent,
      pct,
      state,
    };
  });
}
