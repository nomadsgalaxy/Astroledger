import { Card, Pill, SectionHeader, ProgressBar, fmt } from '../../../_components/atoms';
import { ResizableTableShell } from '../../../_components/useResizableColumns';
import { runCheckpoint } from '@/lib/checkpoint';

const CHECKPOINT_COLS = [
  { key: 'cat',      flex: 1,    min: 160 },
  { key: 'budgeted', width: 110, min: 80 },
  { key: 'actual',   width: 110, min: 80 },
  { key: 'variance', width: 120, min: 90 },
  { key: 'status',   width: 90,  min: 70 },
];
import CheckpointPeriodPicker from '../../../_components/CheckpointPeriodPicker';
import CheckpointActions from '../../../_components/CheckpointActions';

export const dynamic = 'force-dynamic';

export default async function CheckpointPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: periodParam } = await searchParams;
  const period = (periodParam === 'quarter' || periodParam === 'ytd') ? periodParam : 'month' as const;
  const result = await runCheckpoint({ period });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={result ? `${result.planName} · ${result.periodLabel}` : 'No active plan'}
        title="Checkpoint"
        subtitle="Plan vs actual, pro-rated to today. Red = >15% over, yellow = 5–15% over, green = on track. The checkpoint is computed live from the currently active plan - to clear it, deactivate or delete the underlying plan."
        right={<div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <CheckpointActions activePlanId={result?.planId ?? null} activePlanName={result?.planName ?? null} />
          <CheckpointPeriodPicker current={period} />
        </div>}
      />

      {!result ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No active plan</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
              Generate a forecast then activate a plan at <a style={{ color: 'var(--accent)' }} href="/plans">/plans</a>.
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            <Card padding={20}><Stat label="Budgeted (to date)" value={fmt(result.totals.budgeted, { cents: false })} /></Card>
            <Card padding={20}><Stat label="Actual" value={fmt(result.totals.actual, { cents: false })} /></Card>
            <Card padding={20}><Stat label="Variance" value={(result.totals.variance > 0 ? '+' : '') + fmt(result.totals.variance, { cents: false })}
                                     color={result.totals.variance > 0 ? 'var(--error)' : 'var(--success)'} /></Card>
          </div>

          <Card eyebrow="Day-by-day pacing" title={`Day ${result.daysIntoPeriod} of ${result.daysInPeriod}`} padding={20}>
            <ProgressBar value={result.daysIntoPeriod} max={result.daysInPeriod} height={8} />
          </Card>

          <Card eyebrow="Per category" title="Variance breakdown" padding={0}>
            <ResizableTableShell storageKey="astroledger-cols-checkpoint" columns={CHECKPOINT_COLS} gap={18}>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '10px 22px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)',
                fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
                <span>Category</span><span style={{ textAlign: 'right' }}>Budgeted</span><span style={{ textAlign: 'right' }}>Actual</span><span style={{ textAlign: 'right' }}>Variance</span><span>Status</span>
              </div>
              {result.rows.map(r => (
                <div key={r.category} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.category}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'right' }}>{fmt(r.budgeted, { cents: false })}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)', textAlign: 'right' }}>{fmt(r.actual, { cents: false })}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, textAlign: 'right',
                                color: r.status === 'red' ? 'var(--error)' : r.status === 'yellow' ? 'var(--warning)' : 'var(--success)' }}>
                    {r.variance > 0 ? '+' : ''}{fmt(r.variance, { cents: false })}<br />
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{r.pct >= 0 ? '+' : ''}{r.pct.toFixed(0)}%</span>
                  </div>
                  <Pill tone={r.status === 'red' ? 'error' : r.status === 'yellow' ? 'warning' : 'success'}>{r.status.toUpperCase()}</Pill>
                </div>
              ))}
            </div>
            </ResizableTableShell>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat" style={{ marginTop: 10, color: color ?? undefined }}>{value}</div>
    </div>
  );
}
