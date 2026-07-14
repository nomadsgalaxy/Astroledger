import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, Pill, MerchantLogo, fmt, fmtDate } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { getRange } from '@/lib/timeRange.server';

const ORDERS_COLS = [
  { key: 'logo',     width: 40,  min: 40,  resizable: false },
  { key: 'date',     width: 100, min: 70 },
  { key: 'merchant', flex: 1,    min: 140 },
  { key: 'source',   width: 100, min: 70 },
  { key: 'items',    flex: 1,    min: 140 },
  { key: 'amount',   width: 110, min: 80 },
  { key: 'matched',  width: 150, min: 100 },
];

export const dynamic = 'force-dynamic';

export default async function Orders() {
  const range = await getRange();
  const orders = await prisma.order.findMany({
    where: { orderDate: { gte: range.since } },
    orderBy: { orderDate: 'desc' }, take: 200,
    include: { transaction: { select: { id: true, date: true, amount: true, merchant: true } } },
  });
  const linked = orders.filter(o => o.transactionId).length;
  const totalSpend = orders.reduce((s, o) => s + o.amount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${orders.length} orders · ${linked} matched · ${range.label}`}
        title="Orders"
        subtitle="Receipts and purchases from Gmail, Amazon CSV, and browser captures - matched to your bank charges."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Total orders" value={String(orders.length)} /></Card>
        <Card padding={20}><BigStat label="Matched to charges" value={`${linked} / ${orders.length || 0}`} color={linked === orders.length && orders.length > 0 ? 'var(--success)' : 'var(--fg-strong)'} /></Card>
        <Card padding={20}><BigStat label="Total order spend" value={fmt(totalSpend, { cents: false })} /></Card>
      </div>

      <Card padding={0}>
        {orders.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No orders yet. Sync Gmail receipts or import Amazon order history from <a href="/connect" style={{ color: 'var(--accent)' }}>/connect</a>.
          </div>
        ) : (
          <ResizableTableShell storageKey="astroledger-cols-orders" columns={ORDERS_COLS} hPad={18}>
          <div style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 400, overflowY: 'auto' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'var(--cols)',
              padding: '10px 18px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
              fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
              letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
              color: 'var(--fg-muted)', gap: 12,
            }}>
              <span />
              <span>Date</span>
              <span>Merchant</span>
              <span>Source</span>
              <span>Items</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
              <span>Matched</span>
            </div>
            {orders.map(o => {
              const items = o.items ? JSON.parse(o.items) as Array<{ name: string; qty?: number }> : [];
              return (
                <div key={o.id} style={{
                  display: 'grid',
                  gridTemplateColumns: 'var(--cols)',
                  padding: '12px 18px', borderBottom: '1px solid var(--border)',
                  gap: 12, alignItems: 'center',
                }}>
                  <MerchantLogo name={o.merchant} size={32} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(o.orderDate)}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{o.merchant}</div>
                    {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)' }}>open ↗</a>}
                  </div>
                  <Pill tone="ghost">{o.source}</Pill>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {items.slice(0, 3).map(i => i.name).join(' · ') || ' - '}
                    {items.length > 3 ? ` +${items.length - 3}` : ''}
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>
                    {fmt(o.amount)}
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {o.transaction
                      ? <span style={{ color: 'var(--success)' }}>✓ {fmtDate(o.transaction.date)} · {fmt(Math.abs(o.transaction.amount))}</span>
                      : <span style={{ color: 'var(--fg-subtle)' }}>no match</span>}
                  </div>
                </div>
              );
            })}
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
      <div className="t-stat" style={{ marginTop: 10, color: color ?? undefined }}>{value}</div>
    </div>
  );
}
