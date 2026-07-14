import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, Pill, fmt, fmtDate } from '../../../_components/atoms';
import { listTagsFlat } from '@/lib/tags';
import TagAssistClient from '../../../_components/TagAssistClient';

export const dynamic = 'force-dynamic';

export default async function TagAssistPage() {
  const [untagged, allTags] = await Promise.all([
    // Most recent untagged, non-transfer, real (not anticipated) transactions
    prisma.transaction.findMany({
      where: {
        tags: { none: {} },
        isTransfer: false,
        isAnticipated: false,
      },
      include: {
        account: { include: { institution: { select: { name: true } } } },
        subscription: { select: { id: true, merchant: true, cadence: true, amount: true } },
        orders: { select: { id: true, source: true, orderDate: true, amount: true, items: true, url: true } },
      },
      orderBy: [{ date: 'desc' }],
      take: 60,
    }),
    listTagsFlat(),
  ]);

  // For each row, count how many other charges from the same merchant exist
  // and surface the most-used tags on those siblings (cheap server-side prefetch).
  const merchants = Array.from(new Set(untagged.map(t => t.merchant).filter(Boolean) as string[]));
  const siblingCounts = await prisma.transaction.groupBy({
    by: ['merchant'],
    where: { merchant: { in: merchants } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const siblingByMerchant = new Map(siblingCounts.map(r => [r.merchant, { count: r._count._all, sum: r._sum.amount ?? 0 }]));

  // Pre-suggest tags by sniffing the most-frequent tag attached to siblings of each merchant.
  const tagSuggestionByMerchant = new Map<string, string[]>();
  if (merchants.length > 0) {
    const tagged = await prisma.transaction.findMany({
      where: { merchant: { in: merchants }, tags: { some: {} } },
      select: { merchant: true, tags: { select: { name: true } } },
      take: 800,
    });
    for (const t of tagged) {
      if (!t.merchant) continue;
      const list = tagSuggestionByMerchant.get(t.merchant) ?? [];
      for (const tag of t.tags) list.push(tag.name);
      tagSuggestionByMerchant.set(t.merchant, list);
    }
    for (const [m, names] of tagSuggestionByMerchant) {
      const freq: Record<string, number> = {};
      for (const n of names) freq[n] = (freq[n] ?? 0) + 1;
      tagSuggestionByMerchant.set(m, Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${untagged.length} untagged transaction${untagged.length === 1 ? '' : 's'}`}
        title="Tag assistant"
        subtitle={`Each row pulls every signal Astroledger knows about that transaction - merchant history, linked subscription, email receipts - so you can tag with full context. External agents can do the same research over MCP via the merchant_intel, subscription_intel, and transaction_intel tools.`}
      />

      {untagged.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>Inbox zero.</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
              No untagged transactions in view. New imports will surface here when they land.
            </div>
          </div>
        </Card>
      ) : (
        <TagAssistClient
          tags={allTags.map(t => ({
            id: t.id, name: t.name, color: t.color,
            kind: t.kind, parentId: t.parentId,
            parentName: t.parentName, parentColor: t.parentColor,
          }))}
          rows={untagged.map(t => {
            const sibs = t.merchant ? siblingByMerchant.get(t.merchant) : undefined;
            return {
              id: t.id,
              date: t.date.toISOString().slice(0, 10),
              amount: t.amount,
              merchant: t.merchant,
              rawDescription: t.rawDescription,
              account: t.account.name,
              accountMask: t.account.mask,
              institution: t.account.institution.name,
              subscription: t.subscription ? {
                id: t.subscription.id, merchant: t.subscription.merchant,
                cadence: t.subscription.cadence, amount: t.subscription.amount,
              } : null,
              orders: t.orders.map(o => ({
                id: o.id, source: o.source, date: o.orderDate.toISOString().slice(0, 10),
                amount: o.amount, items: o.items, url: o.url,
              })),
              merchantSiblings: sibs ? { count: sibs.count - 1, sum: sibs.sum ?? 0 } : null,
              suggestedTagNames: t.merchant ? (tagSuggestionByMerchant.get(t.merchant) ?? []) : [],
            };
          })}
        />
      )}
    </div>
  );
}
