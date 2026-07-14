import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, ProgressBar, fmt } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { getRange } from '@/lib/timeRange.server';
import ReportsPicker from '../../_components/ReportsPicker';

const CAT_TREND_COLS = [
  { key: 'cat',   flex: 1, min: 140 },
  { key: 'bar',   flex: 1, min: 140 },
  { key: 'prior', width: 120, min: 90 },
  { key: 'delta', width: 100, min: 80 },
];

export const dynamic = 'force-dynamic';

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const yw = (d: Date) => {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((+tmp - +yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};
const yd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export default async function ReportsPage() {
  const range = await getRange();
  // Primary tags (with usage count) for the expense-report picker
  const primaryTags = await prisma.tag.findMany({
    where: { kind: 'primary' },
    select: { id: true, name: true, color: true, _count: { select: { transactions: true } } },
    orderBy: { name: 'asc' },
  });
  primaryTags.sort((a, b) => (b._count.transactions - a._count.transactions) || a.name.localeCompare(b.name));
  const sinceCur = range.since;
  const sincePrev = new Date(+sinceCur - range.days * 86400000);
  // YoY: same window one year prior
  const yoyStart = new Date(+sinceCur - 365 * 86400000);
  const yoyEnd   = new Date(+range.until - 365 * 86400000);

  const txs = await prisma.transaction.findMany({
    where: {
      isTransfer: false,
      OR: [
        { date: { gte: sincePrev } },               // current + prior windows
        { date: { gte: yoyStart, lt: yoyEnd } },    // year-ago equivalent window
      ],
    },
    include: { category: true },
  });

  // Bucket key: day for ≤45d, week for ≤120d, month otherwise
  const bucketKey = (d: Date) => range.days <= 45 ? yd(d) : range.days <= 120 ? yw(d) : ym(d);
  const bucketLabel = (k: string) => range.days <= 45 ? k.slice(5) : range.days <= 120 ? k.slice(5) : k.slice(5);

  const windowBuckets = new Map<string, { in: number; out: number }>();
  let yoyCur = { in: 0, out: 0 };
  let yoyPrev = { in: 0, out: 0 };
  const curMap = new Map<string, number>();
  const prevMap = new Map<string, number>();

  for (const t of txs) {
    if (t.date >= sinceCur && t.date <= range.until) {
      const k = bucketKey(t.date);
      const cur = windowBuckets.get(k) ?? { in: 0, out: 0 };
      if (t.amount > 0) cur.in += t.amount; else cur.out += Math.abs(t.amount);
      windowBuckets.set(k, cur);

      if (t.amount < 0) {
        const cat = t.category?.name ?? 'Other';
        curMap.set(cat, (curMap.get(cat) ?? 0) + Math.abs(t.amount));
      }
      if (t.amount > 0) yoyCur.in += t.amount;
      else              yoyCur.out += Math.abs(t.amount);
    } else if (t.date >= sincePrev && t.date < sinceCur) {
      if (t.amount < 0) {
        const cat = t.category?.name ?? 'Other';
        prevMap.set(cat, (prevMap.get(cat) ?? 0) + Math.abs(t.amount));
      }
    } else if (t.date >= yoyStart && t.date < yoyEnd) {
      if (t.amount > 0) yoyPrev.in += t.amount;
      else              yoyPrev.out += Math.abs(t.amount);
    }
  }

  const buckets = [...windowBuckets.entries()].sort();
  const maxBar = Math.max(1, ...buckets.map(([, v]) => Math.max(v.in, v.out)));

  const catRows = [...new Set([...curMap.keys(), ...prevMap.keys()])]
    .map(name => {
      const c = curMap.get(name) ?? 0;
      const p = prevMap.get(name) ?? 0;
      return { name, current: c, prior: p, delta: c - p, pct: p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0) };
    })
    .sort((a, b) => b.current - a.current);

  // Avg outflow per month, derived from the range window
  const monthsInWindow = Math.max(1, range.days / 30);
  const totalOutflow = buckets.reduce((s, [, v]) => s + v.out, 0);
  const avgPerMonth = totalOutflow / monthsInWindow;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={range.label}
        title="Reports"
        subtitle="Trends, year-over-year, and how this window compares to the prior equal-length window. All numbers honor the global range."
      />

      <Card eyebrow="Expense report" title="Build a packet from a tag" padding={20}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
          Pick a primary tag (e.g. a trip name) and a date range. Astroledger rolls up everything tagged with the
          parent or any of its child tags, splits totals by sub-tag and category, and attaches your receipts
          so you can print the whole thing as a PDF.
        </div>
        <ReportsPicker tags={primaryTags.map(t => ({ id: t.id, name: t.name, color: t.color, count: t._count.transactions }))} />
      </Card>

      <Card eyebrow="Accountant-ready" title="Financial statements" padding={20}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
          Balance Sheet, Income Statement (P&amp;L), and Cash Flow for any period — the three statements an accountant
          expects. Export each as CSV or print the whole packet to PDF.
        </div>
        <Link href="/reports/statements" className="t-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
          Open financial statements →
        </Link>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        <Card padding={20}>
          <div className="t-caption">YoY this window - outflow</div>
          <YoYStat current={yoyCur.out} prior={yoyPrev.out} flip rangeLabel={range.label} />
        </Card>
        <Card padding={20}>
          <div className="t-caption">YoY this window - inflow</div>
          <YoYStat current={yoyCur.in} prior={yoyPrev.in} rangeLabel={range.label} />
        </Card>
        <Card padding={20}>
          <div className="t-caption">Avg outflow / month</div>
          <div className="t-stat" style={{ marginTop: 10 }}>
            {fmt(avgPerMonth, { cents: false })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>derived from {range.label.toLowerCase()}</div>
        </Card>
      </div>

      <Card eyebrow={range.label} title="Inflow vs Outflow" padding={20}>
        {buckets.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>No data yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${buckets.length}, 1fr)`, gap: 4, alignItems: 'end', height: 180 }}>
            {buckets.map(([k, v]) => (
              <div key={k} title={`${k}\nIn: ${fmt(v.in)}\nOut: ${fmt(v.out)}`}
                   style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                  <div style={{ flex: 1, background: 'var(--success)', height: `${(v.in / maxBar) * 100}%`, borderRadius: '2px 2px 0 0', minHeight: 1 }} />
                  <div style={{ flex: 1, background: 'var(--accent)', height: `${(v.out / maxBar) * 100}%`, borderRadius: '2px 2px 0 0', minHeight: 1 }} />
                </div>
                {buckets.length <= 30 && (
                  <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--fg-subtle)' }}>{bucketLabel(k)}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 18, fontSize: 11, color: 'var(--fg-muted)', justifyContent: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, background: 'var(--success)' }} /> Inflow</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, background: 'var(--accent)' }} /> Outflow</span>
        </div>
      </Card>

      <Card eyebrow={`${range.label} vs prior ${range.days} days`} title="Category trend" padding={0}>
        <ResizableTableShell storageKey="astroledger-cols-category-trend" columns={CAT_TREND_COLS} gap={18}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {catRows.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>No data yet.</div>
          ) : catRows.map(r => {
            const max = Math.max(r.current, r.prior, 1);
            const trendColor = r.delta > 0 ? 'var(--error)' : r.delta < 0 ? 'var(--success)' : 'var(--fg-muted)';
            return (
              <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '14px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.name}</div>
                <div>
                  <ProgressBar value={r.current} max={max} height={6} color="var(--accent)" />
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>now: {fmt(r.current)}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'right' }}>was {fmt(r.prior)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: trendColor, textAlign: 'right' }}>
                  {r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : ' - '} {r.pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
        </ResizableTableShell>
      </Card>
    </div>
  );
}

function YoYStat({ current, prior, flip, rangeLabel }: { current: number; prior: number; flip?: boolean; rangeLabel: string }) {
  const delta = current - prior;
  const isBad = flip ? delta > 0 : delta < 0;
  const color = delta === 0 ? 'var(--fg-muted)' : isBad ? 'var(--error)' : 'var(--success)';
  const pctLabel = prior > 0
    ? `${(((current - prior) / prior) * 100).toFixed(0)}%`
    : current > 0 ? 'new' : ' - ';
  return (
    <div>
      <div className="t-stat" style={{ marginTop: 10 }}>
        {fmt(current, { cents: false })}
      </div>
      <div style={{ fontSize: 12, color, marginTop: 4, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {prior === 0 && current === 0 ? ' - no data' : (
          <>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : ' - '} {fmt(Math.abs(delta), { cents: false })} ({pctLabel}) vs {rangeLabel.toLowerCase()} 1y ago
          </>
        )}
      </div>
    </div>
  );
}
