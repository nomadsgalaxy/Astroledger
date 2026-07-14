import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, fmt } from '../../../../_components/atoms';
import SplitTransactionClient from '../../../../_components/SplitTransactionClient';
import { listTagsFlat } from '@/lib/tags';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function SplitTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      account: { include: { institution: true } },
      splits: { include: { category: true, tags: true } },
      category: true,
    },
  });
  if (!tx) notFound();
  const [categories, tags] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    listTagsFlat(),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 720, margin: '0 auto' }}>
      <SectionHeader
        eyebrow={`${tx.date.toISOString().slice(0,10)} · ${tx.account.name}`}
        title={`Split ${tx.merchant ?? 'transaction'}`}
        subtitle={`Original charge: ${tx.amount > 0 ? '+' : '−'}${fmt(Math.abs(tx.amount))}. Splits must sum to the original. The parent stays as the audit record and is excluded from rollups; the children show up everywhere else.`}
      />
      <Card>
        <SplitTransactionClient
          parent={{
            id: tx.id,
            amount: tx.amount,
            merchant: tx.merchant,
            rawDescription: tx.rawDescription,
            currentCategory: tx.category?.name ?? null,
            isSplit: tx.isSplit,
          }}
          existingSplits={tx.splits.map(s => ({
            id: s.id,
            amount: s.amount,
            merchant: s.merchant,
            categoryName: s.category?.name ?? null,
            tagNames: s.tags.map(t => t.name),
            notes: s.notes,
          }))}
          categories={categories.map(c => ({ name: c.name, color: c.color }))}
          tags={tags}
        />
      </Card>
    </div>
  );
}
