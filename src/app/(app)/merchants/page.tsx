import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, MerchantLogo, Pill, ProgressBar, fmt, fmtDate } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { getRange } from '@/lib/timeRange.server';

const MERCH_COLS = [
  { key: 'logo',     width: 40,  min: 40,  resizable: false },
  { key: 'merchant', flex: 1,    min: 160 },
  { key: 'category', width: 130, min: 90 },
  { key: 'count',    width: 90,  min: 70 },
  { key: 'bar',      flex: 1,    min: 120 },
  { key: 'avg',      width: 100, min: 80 },
  { key: 'total',    width: 110, min: 80 },
];

export const dynamic = 'force-dynamic';

export default async function MerchantsPage() {
  const range = await getRange();
  const txs = await prisma.transaction.findMany({
    where: { date: { gte: range.since }, amount: { lt: 0 }, isTransfer: false },
    include: { category: true },
  });

  type Agg = { merchant: string; total: number; count: number; first: Date; last: Date; category: string; avgPerCharge: number };
  const map = new Map<string, Agg>();
  for (const t of txs) {
    const k = t.merchant ?? 'Unknown';
    const cur = map.get(k);
    const amt = Math.abs(t.amount);
    if (!cur) {
      map.set(k, { merchant: k, total: amt, count: 1, first: t.date, last: t.date, category: t.category?.name ?? 'Other', avgPerCharge: amt });
    } else {
      cur.total += amt; cur.count += 1;
      if (t.date < cur.first) cur.first = t.date;
      if (t.date > cur.last) cur.last = t.date;
      cur.avgPerCharge = cur.total / cur.count;
    }
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const maxRow = rows[0]?.total ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${range.label} · outflow only`}
        title="Merchants"
        subtitle="Every vendor you've paid in the selected window, ranked by spend."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Unique merchants" value={String(rows.length)} /></Card>
        <Card padding={20}><BigStat label="Total spend" value={fmt(grandTotal, { cents: false })} color="var(--accent)" /></Card>
        <Card padding={20}><BigStat label="Top merchant" value={rows[0]?.merchant ?? ' - '} /></Card>
        <Card padding={20}><BigStat label="Avg per merchant" value={fmt(rows.length ? grandTotal / rows.length : 0, { cents: false })} /></Card>
      </div>

      <Card padding={0} style={{ overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No merchants yet. Import transactions to see vendor breakdowns.
          </div>
        ) : (
          <ResizableTableShell storageKey="astroledger-cols-merchants" columns={MERCH_COLS} hPad={18} gap={14}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'var(--cols)',
            padding: '10px 18px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)', gap: 14,
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}>
            <span />
            <span>Merchant</span>
            <span>Category</span>
            <span style={{ textAlign: 'right' }}>Charges</span>
            <span>Spend</span>
            <span style={{ textAlign: 'right' }}>Avg</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 400, overflowY: 'auto' }}>
            {rows.map(r => (
              <div key={r.merchant} style={{
                display: 'grid',
                gridTemplateColumns: 'var(--cols)',
                padding: '12px 18px', borderBottom: '1px solid var(--border)', gap: 14, alignItems: 'center',
              }}>
                <MerchantLogo name={r.merchant} size={32} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.merchant}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>First {fmtDate(r.first)} · Last {fmtDate(r.last)}</div>
                </div>
                <Pill tone="default">{r.category}</Pill>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'right' }}>{r.count}x</div>
                <ProgressBar value={r.total} max={maxRow} height={5} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'right' }}>avg {fmt(r.avgPerCharge)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--fg-strong)', textAlign: 'right' }}>{fmt(r.total, { cents: false })}</div>
              </div>
            ))}
          </div>
          </ResizableTableShell>
        )}
      </Card>
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: value.length > 14 ? 16 : 28, marginTop: 6, color: color ?? 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}
