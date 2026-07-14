import { prisma } from '@/lib/prisma';
import { Card, HexBackdrop, SectionHeader, ProgressBar, fmt } from '../../_components/atoms';
import { resolvedKind, KIND_LABELS, type AccountKind } from '@/lib/accountKind';
import { listNetWorthHistory, reconstructNetWorthHistory, captureNetWorthSnapshot } from '@/lib/netWorthSnapshot';
import { getRange } from '@/lib/timeRange.server';
import NetWorthHistoryChart from '../../_components/NetWorthHistoryChart';

export const dynamic = 'force-dynamic';

export default async function NetWorthPage() {
  const range = await getRange();
  const raw = await prisma.bankAccount.findMany({ include: { institution: true } });
  const accounts = raw.map(a => ({ ...a, k: resolvedKind(a) }));
  // Ensure there's at least a snapshot for today so the chart isn't empty on
  // a fresh install. Idempotent - re-running for the same day overwrites.
  await captureNetWorthSnapshot().catch(() => null);
  // Blend recorded snapshots (authoritative, includes market-driven changes
  // in investment accounts) with reconstruction from transactions for the
  // days where no snapshot exists yet. On a fresh install or demo seed this
  // gives you a real time series instead of a flat line through "today".
  // Window mirrors the global range filter from the top bar.
  const snapshots = await listNetWorthHistory({ days: range.days });
  const recon = await reconstructNetWorthHistory({ days: range.days });
  const byDate = new Map(recon.map(p => [p.date, p]));
  for (const s of snapshots) byDate.set(s.date, s);
  const history = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const sumKind = (...kinds: AccountKind[]) =>
    accounts.filter(a => kinds.includes(a.k)).reduce((s, a) => s + (a.balance ?? 0), 0);

  const checking      = sumKind('checking');
  const savingsShort  = sumKind('savings_short');
  const savingsLong   = sumKind('savings_long');
  const savingsRetire = sumKind('savings_retirement');
  const wallets       = sumKind('wallet');
  const investments   = sumKind('investment');
  const credit        = Math.abs(sumKind('credit'));
  const loans         = Math.abs(sumKind('loan'));

  const cash         = checking + savingsShort + wallets;
  const longTerm     = savingsLong + savingsRetire + investments;
  const assets       = cash + longTerm;
  const liabilities  = credit + loans;
  const net          = assets - liabilities;

  type Slice = { label: string; value: number; color: string };
  const assetSlices: Slice[] = [
    { label: KIND_LABELS.checking,           value: checking,      color: 'var(--success)' },
    { label: KIND_LABELS.savings_short,      value: savingsShort,  color: '#65C900' },
    { label: KIND_LABELS.savings_long,       value: savingsLong,   color: '#06B6D4' },
    { label: KIND_LABELS.savings_retirement, value: savingsRetire, color: 'var(--prusa-pro-green)' },
    { label: KIND_LABELS.investment,         value: investments,   color: '#A855F7' },
    { label: KIND_LABELS.wallet,             value: wallets,       color: 'var(--link)' },
  ].filter(s => s.value > 0);
  const liabilitySlices: Slice[] = [
    { label: 'Credit cards', value: credit, color: 'var(--accent)' },
    { label: 'Loans', value: loans, color: '#D946EF' },
  ].filter(s => s.value > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Across all accounts"
        title="Net Worth"
        subtitle="Assets minus liabilities. Investments are last reported balances from your accounts."
      />

      <div style={{
        position: 'relative', background: 'var(--bm-hero-bg)', color: 'var(--bm-hero-fg)',
        borderRadius: 'var(--r-md)', padding: '36px 36px 32px', overflow: 'hidden',
      }}>
        <HexBackdrop opacity={0.13} color={net >= 0 ? 'var(--success)' : 'var(--error)'} size={72} />
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 32, alignItems: 'end' }}>
          <div>
            <div className="t-caption" style={{ color: net >= 0 ? 'var(--success)' : 'var(--error)', marginBottom: 8 }}>NET WORTH</div>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 88,
              lineHeight: 0.9, letterSpacing: 'var(--tr-tight)', textTransform: 'uppercase',
              color: net < 0 ? 'var(--error)' : undefined,
            }}>
              {net < 0 ? '−' : ''}{fmt(Math.abs(net), { cents: false })}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              {accounts.length === 0 ? 'No accounts linked yet.' : `From ${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <DarkStat label="Assets" value={fmt(assets, { cents: false })} color="var(--success)" />
          <DarkStat label="Liabilities" value={fmt(liabilities, { cents: false })} color="var(--accent)" sign="−" />
        </div>
      </div>

      {history.length > 1 && (
        <Card eyebrow={range.label} title="Net worth history" padding={20}>
          <NetWorthHistoryChart history={history} />
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card eyebrow="What you own" title="Asset breakdown">
          {assetSlices.length === 0 ? <Empty /> : assetSlices.map(s => <Slice key={s.label} {...s} total={assets} />)}
        </Card>
        <Card eyebrow="What you owe" title="Liability breakdown">
          {liabilitySlices.length === 0 ? <Empty msg="No liabilities. 🎉" /> : liabilitySlices.map(s => <Slice key={s.label} {...s} total={liabilities} />)}
        </Card>
      </div>

      <Card eyebrow="By account" title="Per-account breakdown" padding={0}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {accounts.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>No accounts yet.</div>
          ) : accounts.map(a => {
            const bal = a.balance ?? 0;
            const isDebt = a.k === 'credit' || a.k === 'loan';
            return (
              <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 150px', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{a.institution.name} · {KIND_LABELS[a.k]}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{a.mask ?? ''}</div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 15,
                  color: a.balance == null ? 'var(--fg-subtle)' : isDebt ? 'var(--error)' : 'var(--fg-strong)' }}>
                  {a.balance == null ? ' - ' : (isDebt ? '−' : '') + fmt(Math.abs(bal), { cents: false })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function DarkStat({ label, value, color, sign }: { label: string; value: string; color: string; sign?: string }) {
  return (
    <div style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 22 }}>
      <div className="t-caption" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 32, lineHeight: 1, color }}>
        {sign ?? ''}{value}
      </div>
    </div>
  );
}

function Slice({ label, value, color, total }: { label: string; value: number; color: string; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 14, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{label}</span>
      </div>
      <ProgressBar value={value} max={total || 1} height={5} color={color} />
      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>
        {fmt(value, { cents: false })} <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function Empty({ msg = 'No data yet.' }: { msg?: string }) {
  return <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>{msg}</div>;
}
