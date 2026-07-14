import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { Card, Pill, SectionHeader, fmt } from '../../../../_components/atoms';
import PlanEditor from '../../../../_components/PlanEditor';
import PlanActions from '../../../../_components/PlanActions';

export const dynamic = 'force-dynamic';

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await prisma.plan.findUnique({
    where: { id },
    include: { lines: { orderBy: [{ scopeKey: 'asc' }, { month: 'asc' }] } },
  });
  if (!plan) notFound();

  // Group lines into a category × month grid
  const months = [...new Set(plan.lines.map(l => l.month.toISOString()))].sort();
  const categories = [...new Set(plan.lines.map(l => l.scope === 'category' ? (l.scopeKey ?? 'Other') : 'Overall'))].sort();
  const total = plan.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${categories.length} categories · ${months.length} months · ${fmt(total, { cents: false })} total`}
        title={plan.name}
        subtitle={<span>{new Date(plan.periodStart).toLocaleDateString()} → {new Date(plan.periodEnd).toLocaleDateString()} · <Pill tone={plan.status === 'active' ? 'success' : 'ghost'}>{plan.status}</Pill></span>}
        right={<PlanActions planId={plan.id} status={plan.status} />}
      />
      <Card padding={0}>
        <PlanEditor
          planId={plan.id}
          months={months}
          categories={categories}
          lines={plan.lines.map(l => ({
            id: l.id,
            scopeKey: l.scope === 'category' ? (l.scopeKey ?? 'Other') : 'Overall',
            month: l.month.toISOString(),
            amount: l.amount,
          }))}
        />
      </Card>
    </div>
  );
}
