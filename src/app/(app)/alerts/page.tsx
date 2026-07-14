import { prisma } from '@/lib/prisma';
import { Card, Pill, SectionHeader, fmt, fmtDate } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import SpendingAlertsManager from '../../_components/SpendingAlertsManager';
import AlertsRecsClient, { type RecIntel } from '../../_components/AlertsRecsClient';
import DismissedRecsClient from '../../_components/DismissedRecsClient';
import { listAlertProgress } from '@/lib/spendingAlerts';
import { listTagsFlat } from '@/lib/tags';
import { getRange } from '@/lib/timeRange.server';
import { expireOldDismissedRecs, getDismissTtlDays, daysUntilExpiry } from '@/lib/dismissedRecs';
import { getDataReadiness } from '@/lib/dataReadiness';
import FinancialInboxCard from '../../_components/FinancialInboxCard';
import RecomputeInsightsButton from '../../_components/RecomputeInsightsButton';

const RECS_COLS = [
  { key: 'detail',  flex: 1,    min: 240 },
  { key: 'savings', width: 140, min: 100 },
  { key: 'actions', width: 110, min: 90, resizable: false },
];
const UPCOMING_COLS = [
  { key: 'merchant', flex: 1,    min: 200 },
  { key: 'next',     width: 120, min: 90 },
  { key: 'amount',   width: 100, min: 80 },
];

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  // Sweep expired dismissed recs FIRST so they don't show up below. Cheap
  // single DELETE; runs on every page load (passive TTL enforcement, no cron).
  await expireOldDismissedRecs();

  const range = await getRange();
  const [openList, dismissedList, openRecsCount, upcomingSubs, capProgress, tags, cats, ttlDays, readiness] = await Promise.all([
    prisma.recommendation.findMany({
      where: { status: 'open', createdAt: { gte: range.since } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.recommendation.findMany({
      where: { status: 'dismissed' },
      orderBy: { dismissedAt: 'desc' },
    }),
    prisma.recommendation.count({ where: { status: 'open', createdAt: { gte: range.since } } }),
    prisma.subscription.findMany({
      where: { status: 'active', nextEstimate: { gte: new Date(), lte: new Date(Date.now() + 14 * 86400000) } },
      orderBy: { nextEstimate: 'asc' },
    }),
    listAlertProgress(),
    listTagsFlat(),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    getDismissTtlDays(),
    getDataReadiness(),
  ]);

  // Intel only needed for open recs (the only ones that show the Act modal).
  const recs = openList;
  const openRecs = openRecsCount;

  const totalSavings = recs.reduce((s, r) => s + (r.monthlySavings ?? 0), 0);
  const capsOver = capProgress.filter(p => p.state === 'over').length;
  const capsWarn = capProgress.filter(p => p.state === 'warn').length;

  // Per-recommendation payment history. Subscription-typed recs walk the
  // linked Subscription's transactions; merchant-typed recs walk
  // transactions matching the merchant. The modal shows this so the user
  // can make an informed call ("how many times have I been charged?") before
  // hitting Cancel / Acknowledge / Dismiss.
  const intelEntries = await Promise.all(recs.map(async r => {
    if (r.refType === 'subscription' && r.refId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: r.refId },
        include: {
          transactions: {
            orderBy: { date: 'desc' }, take: 12,
            select: { date: true, amount: true, merchant: true, account: { select: { name: true } } },
          },
        },
      });
      if (sub) {
        const total = sub.transactions.reduce((s, t) => s + Math.abs(t.amount), 0);
        return [r.id, {
          subject: sub.merchant,
          cadence: sub.cadence,
          subStatus: sub.status,
          estMonthly: sub.amount * (30 / Math.max(1, sub.cadenceDays)),
          history: sub.transactions.map(t => ({
            date: t.date.toISOString().slice(0, 10),
            amount: t.amount,
            merchant: t.merchant ?? sub.merchant,
            account: t.account?.name ?? null,
          })),
          total,
        } as RecIntel] as const;
      }
    }
    if (r.refType === 'merchant' && r.refId) {
      const txs = await prisma.transaction.findMany({
        where: { merchant: r.refId },
        orderBy: { date: 'desc' }, take: 12,
        select: { date: true, amount: true, merchant: true, account: { select: { name: true } } },
      });
      if (txs.length > 0) {
        return [r.id, {
          subject: r.refId,
          history: txs.map(t => ({
            date: t.date.toISOString().slice(0, 10),
            amount: t.amount,
            merchant: t.merchant ?? r.refId!,
            account: t.account?.name ?? null,
          })),
          total: txs.reduce((s, t) => s + Math.abs(t.amount), 0),
        } as RecIntel] as const;
      }
    }
    return [r.id, null] as const;
  }));
  const intel: Record<string, RecIntel | null> = Object.fromEntries(intelEntries);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${openRecs} open · ${capsOver + capsWarn} caps watching · ${range.label}`}
        title="Insights"
        subtitle="Savings opportunities, spending guardrails, and upcoming recurring charges that deserve attention."
        right={<RecomputeInsightsButton />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Open recommendations" value={String(openRecs)} color={openRecs > 0 ? 'var(--warning)' : 'var(--fg-strong)'} /></Card>
        <Card padding={20}><BigStat label="Caps over budget" value={String(capsOver)} color={capsOver > 0 ? 'var(--error)' : 'var(--fg-strong)'} /></Card>
        <Card padding={20}><BigStat label="Potential savings" value={fmt(totalSavings, { cents: false })} color="var(--accent)" /></Card>
        <Card padding={20}><BigStat label="Upcoming charges (14d)" value={String(upcomingSubs.length)} /></Card>
      </div>

      <FinancialInboxCard items={readiness.inbox} />

      <Card eyebrow="Category caps" title="Monthly spending alerts"
            action={<Pill tone={capsOver > 0 ? 'error' : capsWarn > 0 ? 'warning' : 'success'}>
              {capsOver > 0 ? `${capsOver} over` : capsWarn > 0 ? `${capsWarn} warning` : 'All on track'}
            </Pill>}>
        <SpendingAlertsManager
          progress={capProgress}
          tags={tags.map(t => ({ id: t.id, name: t.name, parentName: t.parentName ?? null }))}
          categories={cats.map(c => ({ id: c.id, name: c.name }))}
        />
      </Card>

      <Card eyebrow="Recommendations" title="Savings opportunities" padding={0}>
        <ResizableTableShell storageKey="astroledger-cols-alerts-recs" columns={RECS_COLS} gap={18}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <AlertsRecsClient recs={recs.map(r => ({
            id: r.id, kind: r.kind, title: r.title, detail: r.detail,
            monthlySavings: r.monthlySavings, refType: r.refType, refId: r.refId, status: r.status,
          }))} intel={intel} />
        </div>
        </ResizableTableShell>
      </Card>

      {dismissedList.length > 0 && (
        <Card eyebrow={`Dismissed · auto-delete after ${ttlDays}d`} title="Dismissed recommendations" padding={0}
              action={<Pill tone="ghost">{dismissedList.length}</Pill>}>
          <div style={{ padding: '10px 22px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
            Dismissed alerts move here and are deleted automatically after the
            configured TTL (currently {ttlDays} day{ttlDays === 1 ? '' : 's'}).
            Restore one if you change your mind. Adjust the TTL in <a href="/settings" style={{ color: 'var(--accent)' }}>Settings</a>.
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <DismissedRecsClient
              recs={dismissedList.map(r => ({
                id: r.id, kind: r.kind, title: r.title, detail: r.detail,
                monthlySavings: r.monthlySavings,
                dismissedAt: r.dismissedAt?.toISOString() ?? null,
                daysLeft: daysUntilExpiry(r.dismissedAt, ttlDays) ?? 0,
              }))}
            />
          </div>
        </Card>
      )}

      <Card eyebrow="Next 14 days" title="Upcoming recurring charges" padding={0}>
        <ResizableTableShell storageKey="astroledger-cols-alerts-upcoming" columns={UPCOMING_COLS} gap={18}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {upcomingSubs.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>Nothing scheduled.</div>
          ) : upcomingSubs.map(s => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{s.merchant}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.nextEstimate ? fmtDate(s.nextEstimate) : ' - '}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)', textAlign: 'right' }}>{fmt(s.amount)}</div>
            </div>
          ))}
        </div>
        </ResizableTableShell>
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
