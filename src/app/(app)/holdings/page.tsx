import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, Pill, fmt } from '../../_components/atoms';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import RefreshPricesButton from '../../_components/RefreshPricesButton';
import { holdingsSummary } from '@/lib/holdings';

const HOLD_COLS = [
  { key: 'symbol', width: 110, min: 70 },
  { key: 'desc',   flex: 1,    min: 140 },
  { key: 'units',  width: 90,  min: 70 },
  { key: 'cb',     width: 110, min: 80 },
  { key: 'mv',     width: 110, min: 80 },
  { key: 'gain',   width: 110, min: 80 },
];

export const dynamic = 'force-dynamic';

export default async function HoldingsPage() {
  const holdings = await prisma.holding.findMany({
    include: { account: { include: { institution: { select: { name: true } } } } },
    orderBy: [{ accountId: 'asc' }, { marketValue: 'desc' }],
  });

  // Group by account
  type Pos = (typeof holdings)[number];
  const byAccount = new Map<string, Pos[]>();
  for (const h of holdings) {
    if (!byAccount.has(h.accountId)) byAccount.set(h.accountId, []);
    byAccount.get(h.accountId)!.push(h);
  }

  // Base-currency totals + allocation (converts any foreign holdings via FX).
  const summary = await holdingsSummary();
  const totalMV = summary.totalMarketValue;
  const totalCB = summary.totalCostBasis;
  const totalGain = summary.totalGain;
  const lastPriced = summary.lastPriceAsOf ? new Date(summary.lastPriceAsOf).toLocaleDateString() : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${holdings.length} position${holdings.length === 1 ? '' : 's'} across ${byAccount.size} account${byAccount.size === 1 ? '' : 's'}`}
        title="Investment holdings"
        subtitle={`Share-level positions from SimpleFIN sync or Quicken QIF import (FIFO lot cost basis + price history). Totals in ${summary.baseCurrency}, foreign holdings FX-converted.${lastPriced ? ` Prices last refreshed ${lastPriced}.` : ''}`}
        right={<RefreshPricesButton />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        <Card padding={20}>
          <div className="t-caption">Market value</div>
          <div className="t-stat-sub" style={{ marginTop: 8 }}>{fmt(totalMV, { cents: false })}</div>
        </Card>
        <Card padding={20}>
          <div className="t-caption">Cost basis</div>
          <div className="t-stat-sub" style={{ marginTop: 8 }}>{fmt(totalCB, { cents: false })}</div>
        </Card>
        <Card padding={20}>
          <div className="t-caption">Unrealized gain / loss{summary.totalGainPct != null ? ` (${summary.totalGainPct >= 0 ? '+' : '−'}${Math.abs(summary.totalGainPct).toFixed(1)}%)` : ''}</div>
          <div className="t-stat-sub" style={{ marginTop: 8, color: totalGain >= 0 ? 'var(--success)' : 'var(--error)' }}>
            {totalGain >= 0 ? '+' : '−'}{fmt(Math.abs(totalGain), { cents: false })}
          </div>
        </Card>
      </div>

      {summary.byAccount.length > 1 && totalMV > 0 && (
        <Card eyebrow="Allocation" title="By account" padding={18}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {summary.byAccount.map(a => {
              const pct = (a.marketValue / totalMV) * 100;
              return (
                <div key={a.account} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 56px', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.account}</div>
                  <div style={{ height: 8, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: 'var(--prusa-pro-green)' }} />
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{pct.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {holdings.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No holdings synced yet. Connect an investment account via SimpleFIN - holdings appear here on the next sync.
          </div>
        </Card>
      ) : Array.from(byAccount.entries()).map(([acctId, positions]) => {
        const a = positions[0].account;
        const acctMV = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
        const acctCB = positions.reduce((s, p) => s + (p.costBasis ?? 0), 0);
        return (
          <Card key={acctId} padding={0}
                eyebrow={a.institution.name}
                title={a.name}
                action={
                  <Pill tone="info">
                    {fmt(acctMV, { cents: false })}
                    {acctCB > 0 && (
                      <span style={{ marginLeft: 6, color: (acctMV - acctCB) >= 0 ? 'var(--success)' : 'var(--error)' }}>
                        {(acctMV - acctCB) >= 0 ? '+' : '−'}{fmt(Math.abs(acctMV - acctCB), { cents: false })}
                      </span>
                    )}
                  </Pill>
                }>
            <ResizableTableShell storageKey="astroledger-cols-holdings" columns={HOLD_COLS} gap={14}>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 14, padding: '8px 22px', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
                <div>Symbol</div>
                <div>Description</div>
                <div style={{ textAlign: 'right' }}>Units</div>
                <div style={{ textAlign: 'right' }}>Cost basis</div>
                <div style={{ textAlign: 'right' }}>Market value</div>
                <div style={{ textAlign: 'right' }}>Gain / loss</div>
              </div>
              {/* rows */}
              {positions.map(p => {
                const gain = (p.marketValue ?? 0) - (p.costBasis ?? 0);
                const hasGain = p.costBasis != null && p.marketValue != null;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 14, padding: '11px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: 'var(--fg-strong)' }}>{p.symbol}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg)' }}>{p.description ?? ' - '}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.units.toFixed(4)}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{p.costBasis != null ? fmt(p.costBasis) : ' - '}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12 }}>{p.marketValue != null ? fmt(p.marketValue) : ' - '}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: !hasGain ? 'var(--fg-subtle)' : gain >= 0 ? 'var(--success)' : 'var(--error)' }}>
                      {hasGain ? `${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain))}` : ' - '}
                    </div>
                  </div>
                );
              })}
            </div>
            </ResizableTableShell>
          </Card>
        );
      })}
    </div>
  );
}
