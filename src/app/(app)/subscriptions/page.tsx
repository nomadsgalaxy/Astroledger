import { prisma } from '@/lib/prisma';
import { Card, Pill, SectionHeader, MerchantLogo, Btn, fmt, fmtDate } from '../../_components/atoms';
import TagPicker, { type TagOption } from '../../_components/TagPicker';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import Link from 'next/link';

const SUBS_COLS = [
  { key: 'logo',     width: 40,  min: 40,  resizable: false },
  { key: 'merchant', flex: 1.4,  min: 140 },
  { key: 'cadence',  width: 100, min: 70 },
  { key: 'amount',   width: 90,  min: 70 },
  { key: 'monthly',  width: 110, min: 80 },
  { key: 'next',     width: 100, min: 80 },
  { key: 'tags',     flex: 1.2,  min: 140 },
  { key: 'conf',     width: 90,  min: 70 },
  { key: 'status',   width: 80,  min: 70 },
];

export const dynamic = 'force-dynamic';

export default async function Subscriptions() {
  const subsRaw = await prisma.subscription.findMany({
    orderBy: [{ status: 'asc' }, { amount: 'desc' }],
    include: { tags: { include: { parent: { select: { name: true, color: true } } } } },
  });
  const subs = subsRaw.map(s => ({
    ...s,
    tagOptions: s.tags.map(t => ({
      id: t.id, name: t.name, color: t.color,
      kind: (t.kind === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
      parentId: t.parentId, parentName: t.parent?.name ?? null,
      parentColor: t.parent?.color ?? null,
    })) as TagOption[],
  }));

  const active = subs.filter(s => s.status === 'active');
  const monthlyTotal = active.reduce((s, x) => s + x.amount * (30 / Math.max(1, x.cadenceDays)), 0);
  const annualTotal = monthlyTotal * 12;
  const now = Date.now();
  const dueNext7 = active.filter(s => s.nextEstimate && (+s.nextEstimate - now) <= 7 * 86400000 && +s.nextEstimate >= now);
  const dueNext7Total = dueNext7.reduce((s, x) => s + x.amount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${active.length} active · ${subs.length - active.length} other`}
        title="Subscriptions"
        subtitle="Recurring charges we detected. Cadence is auto-classified from your transaction history."
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/alerts"><Btn variant="outline" size="md" icon="✦">Find savings</Btn></Link>
            <Btn variant="primary" size="md" icon="+">Add manual</Btn>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Active" value={String(active.length)} /></Card>
        <Card padding={20}><BigStat label="~Monthly" value={fmt(monthlyTotal, { cents: false })} color="var(--accent)" sign="−" /></Card>
        <Card padding={20}><BigStat label="~Annual" value={fmt(annualTotal, { cents: false })} color="var(--accent)" sign="−" /></Card>
        <Card padding={20}><BigStat label="Next 7 days" value={fmt(dueNext7Total, { cents: false })} /></Card>
      </div>

      <Card padding={0} style={{ overflow: 'hidden' }}>
        <ResizableTableShell storageKey="astroledger-cols-subscriptions" columns={SUBS_COLS}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'var(--cols)',
          padding: '10px 22px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          color: 'var(--fg-muted)', gap: 12,
        }}>
          <span />
          <span>Merchant</span>
          <span>Cadence</span>
          <span style={{ textAlign: 'right' }}>Amount</span>
          <span style={{ textAlign: 'right' }}>~Monthly</span>
          <span>Next est.</span>
          <span>Tags</span>
          <span>Confidence</span>
          <span>Status</span>
        </div>
        {subs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No subscriptions detected yet. Import transactions to scan for recurring charges.
          </div>
        ) : subs.map(s => (
          <div key={s.id} style={{
            display: 'grid',
            gridTemplateColumns: 'var(--cols)',
            padding: '12px 22px', borderBottom: '1px solid var(--border)',
            gap: 12, alignItems: 'center',
          }}>
            <MerchantLogo name={s.merchant} size={32} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{s.merchant}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.cadence}</div>
            <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>{fmt(s.amount)}</div>
            <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontSize: 12, color: 'var(--fg-muted)' }}>{fmt(s.amount * 30 / Math.max(1, s.cadenceDays))}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.nextEstimate ? fmtDate(s.nextEstimate) : ' - '}</div>
            <TagPicker scope="subscription" entityId={s.id} initial={s.tagOptions} compact />
            <div>
              <div style={{ width: 70, height: 4, background: 'var(--bg-panel)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${s.confidence * 100}%`, background: s.confidence >= 0.7 ? 'var(--success)' : 'var(--warning)' }} />
              </div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-subtle)', marginTop: 2 }}>{Math.round(s.confidence * 100)}%</div>
            </div>
            <Pill tone={s.status === 'active' ? 'success' : s.status === 'canceled' ? 'ghost' : 'warning'}>{s.status}</Pill>
          </div>
        ))}
        </ResizableTableShell>
      </Card>
    </div>
  );
}

function BigStat({ label, value, color, sign }: { label: string; value: string; color?: string; sign?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat" style={{ marginTop: 10, color: color ?? undefined }}>
        {sign ?? ''}{value}
      </div>
    </div>
  );
}
