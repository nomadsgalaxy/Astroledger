import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Card, Pill, SectionHeader, fmt } from '../../../_components/atoms';
import { ResizableTableShell } from '../../../_components/useResizableColumns';
import PlanActions from '../../../_components/PlanActions';

const PLANS_COLS = [
  { key: 'name',    flex: 1,    min: 180 },
  { key: 'status',  width: 120, min: 80 },
  { key: 'lines',   width: 140, min: 100 },
  { key: 'total',   width: 140, min: 100 },
  { key: 'actions', flex: 1,    min: 160, resizable: false },
];

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  const plans = await prisma.plan.findMany({
    orderBy: [{ status: 'asc' }, { periodStart: 'desc' }],
    include: { lines: true },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${plans.length} plan${plans.length === 1 ? '' : 's'}`}
        title="Plans"
        subtitle="Versioned budgets. Create one from your latest forecast, edit, and activate. Old plans stay queryable for benchmarking."
        right={<PlanActions />}
      />

      {plans.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No plans yet</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Generate a forecast first (<a style={{ color: 'var(--accent)' }} href="/forecast">/forecast</a>), then create a plan from it.
            </div>
            <PlanActions />
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {plans.map(p => {
            const total = p.lines.reduce((s, l) => s + l.amount, 0);
            return (
              <Card key={p.id} padding={0}>
                <ResizableTableShell storageKey="astroledger-cols-plans" columns={PLANS_COLS} hPad={16} gap={18}>
                <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <Link href={`/plans/${p.id}`} style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)', textDecoration: 'none' }}>{p.name}</Link>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      {new Date(p.periodStart).toLocaleDateString()} → {new Date(p.periodEnd).toLocaleDateString()}
                    </div>
                  </div>
                  <Pill tone={p.status === 'active' ? 'success' : p.status === 'superseded' ? 'ghost' : p.status === 'archived' ? 'ghost' : 'info'}>{p.status}</Pill>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                    {p.lines.length} lines
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--fg-strong)' }}>
                    {fmt(total, { cents: false })} total
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <PlanActions planId={p.id} status={p.status} />
                  </div>
                </div>
                </ResizableTableShell>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
