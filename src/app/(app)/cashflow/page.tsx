import { prisma } from '@/lib/prisma';
import CashflowClient from '../../_components/CashflowClient';
import { getRange } from '@/lib/timeRange.server';

export const dynamic = 'force-dynamic';

const PALETTE = ['#FD5000', '#346EF4', '#65C900', '#FFDC00', '#D946EF', '#06B6D4', '#A855F7', '#F97316', '#EC4899', '#3F9C35'];

export default async function CashflowPage() {
  const range = await getRange();
  const sinceCur = range.since;
  const sincePrev = new Date(+sinceCur - range.days * 86400000);

  const windowTx = await prisma.transaction.findMany({
    where: { date: { gte: sinceCur }, isTransfer: false },
    include: { tags: { select: { id: true, name: true, color: true, kind: true, parentId: true, parent: { select: { name: true, color: true } } } } },
  });

  // Transfer pairs in the window - both legs share a transferGroupId. We
  // aggregate by (source account → destination account) so the cashflow page
  // can show "Spend (1011) → Growth (2588) · $400 across 4 transfers" rows.
  const transferTx = await prisma.transaction.findMany({
    where: {
      date: { gte: sinceCur },
      isTransfer: true,
      transferGroupId: { not: null },
    },
    select: {
      id: true, amount: true, transferGroupId: true,
      account: { select: { id: true, name: true, mask: true, institution: { select: { name: true } } } },
    },
  });
  // Group by transferGroupId, then derive source/dest
  const pairsByGroup = new Map<string, typeof transferTx>();
  for (const t of transferTx) {
    const g = t.transferGroupId!;
    if (!pairsByGroup.has(g)) pairsByGroup.set(g, []);
    pairsByGroup.get(g)!.push(t);
  }
  type RouteKey = string;
  const routeAgg = new Map<RouteKey, { src: { name: string; mask: string | null }; dst: { name: string; mask: string | null }; total: number; count: number }>();
  for (const [, legs] of pairsByGroup) {
    if (legs.length < 2) continue; // half a pair somehow - skip
    legs.sort((a, b) => a.amount - b.amount);
    const out = legs[0]; const inflow = legs[legs.length - 1];
    if (out.amount >= 0 || inflow.amount <= 0) continue; // weird shape; skip
    const k: RouteKey = `${out.account.id}→${inflow.account.id}`;
    const cur = routeAgg.get(k) ?? {
      src: { name: out.account.name,    mask: out.account.mask },
      dst: { name: inflow.account.name, mask: inflow.account.mask },
      total: 0, count: 0,
    };
    cur.total += Math.abs(out.amount);
    cur.count += 1;
    routeAgg.set(k, cur);
  }
  const transferRoutes = Array.from(routeAgg.values()).sort((a, b) => b.total - a.total);
  const transferTotalAbs = transferRoutes.reduce((s, r) => s + r.total, 0);
  const priorTx = await prisma.transaction.findMany({
    where: { date: { gte: sincePrev, lt: sinceCur }, isTransfer: false },
    select: { amount: true },
  });

  // Attribute each outflow tx to a single bucket so totals don't double-count.
  // Order of preference: primary tag → first tag → "Untagged".
  function bucketFor(t: { tags: { name: string; kind: string; parentId: string | null; parent: { name: string } | null }[] }): string {
    const primary = t.tags.find(tag => tag.kind === 'primary');
    if (primary) return primary.name;
    const first = t.tags[0];
    if (first) return first.parent?.name ? `${first.parent.name} / ${first.name}` : first.name;
    return 'Untagged';
  }

  // Track a representative color per bucket so the bar/sankey colors match the tag.
  const inflowMap = new Map<string, number>();
  const outflowMap = new Map<string, number>();
  const colorFor = new Map<string, string>();
  for (const t of windowTx) {
    if (t.amount > 0) {
      const k = t.merchant ?? 'Other income';
      inflowMap.set(k, (inflowMap.get(k) ?? 0) + t.amount);
    } else {
      const k = bucketFor(t);
      outflowMap.set(k, (outflowMap.get(k) ?? 0) + Math.abs(t.amount));
      if (!colorFor.has(k)) {
        // Resolve color: explicit > parent (for child tags) > skip and let palette assign later.
        const tag = t.tags.find(x => x.kind === 'primary') ?? t.tags[0];
        const resolved = tag?.color ?? tag?.parent?.color ?? null;
        if (resolved) colorFor.set(k, resolved);
      }
    }
  }
  const inflows = [...inflowMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, amount], i) => ({ name, amount, color: PALETTE[i % PALETTE.length] }));
  const outflows = [...outflowMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, amount], i) => ({ name, amount, color: colorFor.get(name) ?? PALETTE[i % PALETTE.length] }));

  const totalIn = windowTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = windowTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const prevTotalOut = priorTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = totalIn - totalOut;
  const savingsRate = totalIn > 0 ? Math.round(((totalIn - totalOut) / totalIn) * 100) : 0;

  // Day-strip: one cell per day in the window
  const daily: Array<{ d: number; iso: string; in: number; out: number }> = [];
  for (let i = 0; i < range.days; i++) {
    const dt = new Date(+sinceCur + i * 86400000);
    daily.push({ d: i + 1, iso: dt.toISOString().slice(0, 10), in: 0, out: 0 });
  }
  const byIso = new Map(daily.map((entry, i) => [entry.iso, i] as const));
  for (const t of windowTx) {
    const idx = byIso.get(t.date.toISOString().slice(0, 10));
    if (idx === undefined) continue;
    if (t.amount > 0) daily[idx].in += t.amount;
    else daily[idx].out += Math.abs(t.amount);
  }

  return (
    <CashflowClient
      rangeLabel={range.label}
      rangeDays={range.days}
      totalIn={totalIn} totalOut={totalOut} net={net} savingsRate={savingsRate}
      prevTotalOut={prevTotalOut}
      inflows={inflows} outflows={outflows}
      daily={daily.map(d => ({ d: d.d, in: d.in, out: d.out }))}
      transferRoutes={transferRoutes}
      transferTotalAbs={transferTotalAbs}
    />
  );
}
