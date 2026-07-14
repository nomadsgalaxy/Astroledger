import { Card, SectionHeader, ProgressBar, fmt } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { benchmarkByCategory } from '@/lib/benchmark';

const BENCH_COLS = [
  { key: 'cat',     width: 160, min: 110 },
  { key: 'current', flex: 1,    min: 110 },
  { key: 'prior',   flex: 1,    min: 110 },
  { key: 'yoy',     flex: 1,    min: 110 },
  { key: 'delta',   width: 120, min: 80 },
];
const PLAN_HIST_COLS = [
  { key: 'name',    flex: 1,    min: 160 },
  { key: 'status',  width: 120, min: 80 },
  { key: 'start',   width: 100, min: 80 },
  { key: 'created', flex: 1,    min: 160 },
];
import { prisma } from '@/lib/prisma';
import { getRange } from '@/lib/timeRange.server';

export const dynamic = 'force-dynamic';

export default async function BenchmarksPage() {
  const range = await getRange();
  const [rows, plans] = await Promise.all([
    benchmarkByCategory(range.since, range.until),
    prisma.plan.findMany({ orderBy: [{ status: 'asc' }, { periodStart: 'desc' }], take: 10 }),
  ]);

  const maxCur = Math.max(1, ...rows.map(r => Math.max(r.current, r.prior, r.yearAgo)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${range.label} · category comparisons`}
        title="Benchmarks"
        subtitle="Each category compared to the same-length window before, and to the same window one year ago. Plus a plan-history snapshot."
      />

      <Card eyebrow={range.label} title={`Window vs prior ${range.days}d vs same window 1y ago`} padding={0}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {rows.length === 0 ? <Empty /> : (
            <ResizableTableShell storageKey="astroledger-cols-benchmarks" columns={BENCH_COLS} gap={18}>
              <div style={{
                display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18,
                padding: '10px 22px', borderBottom: '1px solid var(--border)',
                background: 'var(--bg-subtle)',
                fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
                letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
                color: 'var(--fg-muted)',
              }}>
                <span>Category</span>
                <span>Current</span>
                <span>Prior {range.days}d</span>
                <span>1y ago (same window)</span>
                <span style={{ textAlign: 'right' }}>Δ vs prior</span>
              </div>
              {rows.map(r => {
                const delta = r.current - r.prior;
                const pct = r.prior > 0 ? ((r.current - r.prior) / r.prior) * 100 : (r.current > 0 ? 100 : 0);
                return (
                  <div key={r.category} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.category}</div>
                    <Cell value={r.current} max={maxCur} color="var(--accent)" />
                    <Cell value={r.prior} max={maxCur} color="var(--gray-500)" />
                    <Cell value={r.yearAgo} max={maxCur} color="var(--gray-700)" />
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, textAlign: 'right',
                      color: delta > 0 ? 'var(--error)' : delta < 0 ? 'var(--success)' : 'var(--fg-muted)' }}>
                      {delta > 0 ? '▲' : delta < 0 ? '▼' : ' - '} {pct.toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </ResizableTableShell>
          )}
        </div>
      </Card>

      <Card eyebrow="Plan history" title="Recent plans" padding={0}>
        <ResizableTableShell storageKey="astroledger-cols-plan-history" columns={PLAN_HIST_COLS} gap={18}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {plans.length === 0 ? <Empty msg="No plans created yet." /> : plans.map(p => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.status}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(p.periodStart).toLocaleDateString()}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
                created {new Date(p.createdAt).toLocaleDateString()}
                {p.activatedAt && ` · activated ${new Date(p.activatedAt).toLocaleDateString()}`}
              </div>
            </div>
          ))}
        </div>
        </ResizableTableShell>
      </Card>
    </div>
  );
}

function Cell({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div>
      <ProgressBar value={value} max={max} height={5} color={color} />
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{fmt(value)}</div>
    </div>
  );
}

function Empty({ msg = 'No data yet.' }: { msg?: string }) {
  return <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>{msg}</div>;
}
