// Deep-context lookups used by the tag-assist page AND the MCP intel tools.
// Same code path → external agents and the in-app UI see the same data.

import { prisma } from './prisma';

const HISTORY_LIMIT = 100;

export type MerchantIntel = {
  merchant: string;
  matchedMerchants: string[];          // when input was substring, this lists the exact merchants matched
  totals: { count: number; sumOut: number; sumIn: number; net: number; first: string | null; last: string | null };
  cadence: { avgDaysBetween: number | null; estLabel: string | null };
  recentTransactions: Array<{ id: string; date: string; amount: number; rawDescription: string; account: string; accountMask: string | null; tags: string[]; isTransfer: boolean }>;
  subscriptions: Array<{ id: string; merchant: string; amount: number; cadence: string; status: string; nextEstimate: string | null }>;
  relatedOrders: Array<{ id: string; source: string; date: string; amount: number; items: string | null; url: string | null }>;
  attachedTagFrequency: Record<string, number>;
  suggestedTags: string[];
};

export type SubscriptionIntel = {
  subscription: { id: string; merchant: string; amount: number; cadence: string; cadenceDays: number; status: string; firstSeen: string; lastSeen: string; nextEstimate: string | null; confidence: number; notes: string | null };
  attachedTags: string[];
  charges: Array<{ id: string; date: string; amount: number; account: string; tags: string[] }>;
  relatedOrders: Array<{ id: string; source: string; date: string; amount: number; items: string | null; url: string | null }>;
};

export type TagRef = {
  id: string;
  name: string;
  color: string | null;
  kind: 'primary' | 'secondary';
  parentId: string | null;
  parentName: string | null;
  parentColor: string | null;
};

export type TransactionIntel = {
  transaction: { id: string; date: string; amount: number; currency: string; baseAmount: number | null; rawDescription: string; merchant: string | null; notes: string | null; isTransfer: boolean; isAnticipated: boolean; tags: TagRef[]; account: { id: string; name: string; mask: string | null; institution: string } };
  subscription: { id: string; merchant: string; cadence: string } | null;
  orders: Array<{ id: string; source: string; date: string; amount: number; items: string | null; url: string | null }>;
  merchantHistory: { count: number; sumOut: number; sumIn: number; first: string | null; last: string | null; lastFive: Array<{ id: string; date: string; amount: number; rawDescription: string }> };
  sameAmountNeighbors: Array<{ id: string; date: string; amount: number; merchant: string | null; account: string }>;
};

export async function merchantIntel(input: string): Promise<MerchantIntel> {
  const q = input.trim();
  if (!q) throw new Error('merchant required');
  // Try exact match first, then case-insensitive contains
  const exact = await prisma.transaction.findFirst({ where: { merchant: q }, select: { merchant: true } });
  const merchants = exact
    ? [q]
    : (await prisma.transaction.groupBy({
        by: ['merchant'],
        where: { merchant: { contains: q } },
        _count: { _all: true },
      })).map(r => r.merchant!).filter(Boolean).slice(0, 5);
  const txns = await prisma.transaction.findMany({
    where: { merchant: { in: merchants } },
    include: { account: { include: { institution: { select: { name: true } } } }, tags: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: HISTORY_LIMIT,
  });
  const counts = await prisma.transaction.aggregate({
    where: { merchant: { in: merchants } },
    _count: { _all: true }, _sum: { amount: true },
    _min: { date: true }, _max: { date: true },
  });
  const sumOut = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const sumIn  = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  // Cadence: average days between consecutive charges
  const dates = txns.map(t => +t.date).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
  const avg = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  const estLabel = avg == null ? null
    : avg < 4 ? 'multiple per week'
    : avg < 10 ? 'weekly-ish'
    : avg < 18 ? 'biweekly'
    : avg < 40 ? 'monthly'
    : avg < 100 ? 'quarterly'
    : 'irregular / annual';

  const subs = await prisma.subscription.findMany({ where: { merchant: { in: merchants } } });
  const orders = await prisma.order.findMany({
    where: { merchant: { contains: merchants[0] ?? q } },
    orderBy: { orderDate: 'desc' }, take: 10,
  });

  const tagFreq: Record<string, number> = {};
  for (const t of txns) for (const tag of t.tags) tagFreq[tag.name] = (tagFreq[tag.name] ?? 0) + 1;
  // Top-2 most-attached tags are the natural suggestion for an untagged charge from this merchant
  const suggestedTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  return {
    merchant: merchants[0] ?? q,
    matchedMerchants: merchants,
    totals: {
      count: counts._count._all,
      sumOut, sumIn, net: sumIn - sumOut,
      first: counts._min.date?.toISOString() ?? null,
      last: counts._max.date?.toISOString() ?? null,
    },
    cadence: { avgDaysBetween: avg, estLabel },
    recentTransactions: txns.slice(0, 25).map(t => ({
      id: t.id, date: t.date.toISOString().slice(0, 10), amount: t.amount,
      rawDescription: t.rawDescription,
      account: t.account.name,
      accountMask: t.account.mask,
      tags: t.tags.map(x => x.name),
      isTransfer: t.isTransfer,
    })),
    subscriptions: subs.map(s => ({
      id: s.id, merchant: s.merchant, amount: s.amount, cadence: s.cadence, status: s.status,
      nextEstimate: s.nextEstimate?.toISOString() ?? null,
    })),
    relatedOrders: orders.map(o => ({
      id: o.id, source: o.source, date: o.orderDate.toISOString().slice(0, 10),
      amount: o.amount, items: o.items, url: o.url,
    })),
    attachedTagFrequency: tagFreq,
    suggestedTags,
  };
}

export async function subscriptionIntel(subscriptionId: string): Promise<SubscriptionIntel> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tags: { select: { name: true } } },
  });
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);
  const charges = await prisma.transaction.findMany({
    where: { subscriptionId: sub.id },
    include: { account: { select: { name: true } }, tags: { select: { name: true } } },
    orderBy: { date: 'desc' }, take: HISTORY_LIMIT,
  });
  const orders = await prisma.order.findMany({
    where: { merchant: { contains: sub.merchant } },
    orderBy: { orderDate: 'desc' }, take: 10,
  });
  return {
    subscription: {
      id: sub.id, merchant: sub.merchant, amount: sub.amount,
      cadence: sub.cadence, cadenceDays: sub.cadenceDays, status: sub.status,
      firstSeen: sub.firstSeen.toISOString(), lastSeen: sub.lastSeen.toISOString(),
      nextEstimate: sub.nextEstimate?.toISOString() ?? null,
      confidence: sub.confidence, notes: sub.notes,
    },
    attachedTags: sub.tags.map(t => t.name),
    charges: charges.map(c => ({
      id: c.id, date: c.date.toISOString().slice(0, 10),
      amount: c.amount, account: c.account.name,
      tags: c.tags.map(t => t.name),
    })),
    relatedOrders: orders.map(o => ({
      id: o.id, source: o.source, date: o.orderDate.toISOString().slice(0, 10),
      amount: o.amount, items: o.items, url: o.url,
    })),
  };
}

export async function transactionIntel(transactionId: string): Promise<TransactionIntel> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      account: { include: { institution: { select: { name: true } } } },
      // Full tag rows so the modal's TagPicker can render + edit without
      // a second roundtrip. Parent is included so child tags inherit color.
      tags: {
        include: { parent: { select: { name: true, color: true } } },
      },
      subscription: { select: { id: true, merchant: true, cadence: true } },
      orders: true,
    },
  });
  if (!tx) throw new Error(`Transaction ${transactionId} not found`);

  // Merchant context
  let history = { count: 0, sumOut: 0, sumIn: 0, first: null as string | null, last: null as string | null, lastFive: [] as TransactionIntel['merchantHistory']['lastFive'] };
  if (tx.merchant) {
    const all = await prisma.transaction.findMany({
      where: { merchant: tx.merchant, id: { not: tx.id } },
      select: { id: true, date: true, amount: true, rawDescription: true },
      orderBy: { date: 'desc' },
      take: HISTORY_LIMIT,
    });
    const agg = await prisma.transaction.aggregate({
      where: { merchant: tx.merchant, id: { not: tx.id } },
      _count: { _all: true }, _min: { date: true }, _max: { date: true },
    });
    history = {
      count: agg._count._all,
      sumOut: all.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
      sumIn:  all.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      first: agg._min.date?.toISOString() ?? null,
      last:  agg._max.date?.toISOString() ?? null,
      lastFive: all.slice(0, 5).map(t => ({
        id: t.id, date: t.date.toISOString().slice(0, 10),
        amount: t.amount, rawDescription: t.rawDescription,
      })),
    };
  }

  // Same-amount neighbors within ±5 days (potential transfer pair / dupe context)
  const dayWindow = new Date(+tx.date - 5 * 86_400_000);
  const dayEnd = new Date(+tx.date + 5 * 86_400_000);
  const neighbors = await prisma.transaction.findMany({
    where: {
      id: { not: tx.id },
      amount: { gte: Math.abs(tx.amount) - 0.5, lte: Math.abs(tx.amount) + 0.5 },
      date: { gte: dayWindow, lte: dayEnd },
    },
    include: { account: { select: { name: true } } },
    take: 6,
  });
  // Also include inverse sign (transfer-pair candidates)
  const invNeighbors = await prisma.transaction.findMany({
    where: {
      id: { not: tx.id },
      amount: { gte: -Math.abs(tx.amount) - 0.5, lte: -Math.abs(tx.amount) + 0.5 },
      date: { gte: dayWindow, lte: dayEnd },
    },
    include: { account: { select: { name: true } } },
    take: 6,
  });
  const combinedNeighbors = [...neighbors, ...invNeighbors].slice(0, 10);

  return {
    transaction: {
      id: tx.id, date: tx.date.toISOString(), amount: tx.amount,
      currency: tx.currency, baseAmount: tx.baseAmount,
      rawDescription: tx.rawDescription, merchant: tx.merchant, notes: tx.notes,
      isTransfer: tx.isTransfer, isAnticipated: tx.isAnticipated,
      tags: tx.tags.map(t => ({
        id: t.id, name: t.name, color: t.color,
        kind: (t.kind === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
        parentId: t.parentId,
        parentName: t.parent?.name ?? null,
        parentColor: t.parent?.color ?? null,
      })),
      account: {
        id: tx.account.id, name: tx.account.name, mask: tx.account.mask,
        institution: tx.account.institution.name,
      },
    },
    subscription: tx.subscription
      ? { id: tx.subscription.id, merchant: tx.subscription.merchant, cadence: tx.subscription.cadence }
      : null,
    orders: tx.orders.map(o => ({
      id: o.id, source: o.source, date: o.orderDate.toISOString().slice(0, 10),
      amount: o.amount, items: o.items, url: o.url,
    })),
    merchantHistory: history,
    sameAmountNeighbors: combinedNeighbors.map(n => ({
      id: n.id, date: n.date.toISOString().slice(0, 10),
      amount: n.amount, merchant: n.merchant,
      account: n.account.name,
    })),
  };
}
