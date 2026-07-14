import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Card, Pill, SectionHeader, Btn, fmt } from '../../_components/atoms';
import AccountKindSelector from '../../_components/AccountKindSelector';
import AccountNameEdit from '../../_components/AccountNameEdit';
import AccountMergeBtn from '../../_components/AccountMergeBtn';
import HiddenAccountsToggle from '../../_components/HiddenAccountsToggle';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { KIND_LABELS, KIND_ORDER, isAsset, resolvedKind, type AccountKind } from '@/lib/accountKind';

const ACCT_COLS = [
  { key: 'logo',     width: 40,  min: 40,  resizable: false },
  { key: 'name',     flex: 1,    min: 200 },
  { key: 'source',   width: 100, min: 80 },
  { key: 'kind',     width: 220, min: 160 },
  { key: 'balance',  width: 120, min: 90 },
  { key: 'actions',  width: 150, min: 120, resizable: false },
];
import { getInactiveMonths, latestTxByAccount, isStale } from '@/lib/inactiveAccounts';
import { healthBadge } from '@/lib/syncHealth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ showHidden?: string }>;

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const showHidden = sp.showHidden === '1';

  const raw = await prisma.bankAccount.findMany({
    include: {
      institution: true,
      _count: { select: { transactions: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  // Derive stale (inactive) status from the user-configured threshold.
  const thresholdMonths = await getInactiveMonths();
  const latestByAcct = await latestTxByAccount(raw.map(a => a.id));
  const enriched = raw.map(a => ({
    ...a,
    txCount: a._count.transactions,
    resolvedKind: resolvedKind(a),
    latestTx: latestByAcct.get(a.id) ?? null,
    isStale: isStale({
      latestTx: latestByAcct.get(a.id) ?? null,
      createdAt: a.createdAt,
      thresholdMonths,
    }),
  }));
  const hiddenCount = enriched.filter(a => a.isStale).length;
  // The "accounts" list used downstream is the FILTERED set (visible only),
  // unless the user explicitly toggled showHidden. Totals follow the same
  // visible set so hidden accounts don't sneak into net-worth.
  const accounts = showHidden ? enriched : enriched.filter(a => !a.isStale);

  // Group by resolved kind
  const groups = new Map<AccountKind, typeof accounts>();
  for (const a of accounts) {
    const k = a.resolvedKind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  // Hero totals (uses kind, not raw type)
  const sumOf = (filter: (k: AccountKind) => boolean) =>
    accounts.filter(a => filter(a.resolvedKind)).reduce((s, a) => s + (a.balance ?? 0), 0);
  const totalCash       = sumOf(k => k === 'checking' || k === 'wallet' || k.startsWith('savings_'));
  const totalInvest     = sumOf(k => k === 'investment');
  const totalCreditDebt = Math.abs(sumOf(k => k === 'credit' || k === 'loan'));
  const totalAssets     = accounts.filter(a => isAsset(a.resolvedKind)).reduce((s, a) => s + (a.balance ?? 0), 0);
  const totalLiabs      = Math.abs(accounts.filter(a => !isAsset(a.resolvedKind)).reduce((s, a) => s + (a.balance ?? 0), 0));
  const netWorth        = totalAssets - totalLiabs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${accounts.length} of ${enriched.length} account${enriched.length === 1 ? '' : 's'} linked${hiddenCount > 0 && !showHidden ? ` · ${hiddenCount} hidden (no activity in ${thresholdMonths}+ months)` : ''}`}
        title="Accounts"
        subtitle="Every bank, card, brokerage, and wallet feeding Astroledger. Use the dropdown to categorize how each account counts toward your savings goals and net worth."
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {hiddenCount > 0 && (
              <HiddenAccountsToggle showHidden={showHidden} hiddenCount={hiddenCount} thresholdMonths={thresholdMonths} />
            )}
            <Link href="/connect"><Btn variant="outline" size="md" icon="↻">Re-sync all</Btn></Link>
            <Link href="/connect"><Btn variant="primary" size="md" icon="⚙">Manage data</Btn></Link>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Cash + Savings" value={fmt(totalCash, { cents: false })} color="var(--success)" /></Card>
        <Card padding={20}><BigStat label="Credit + Loans" value={fmt(totalCreditDebt, { cents: false })} color="var(--error)" sign="−" /></Card>
        <Card padding={20}><BigStat label="Investments" value={fmt(totalInvest, { cents: false })} color="var(--prusa-pro-green)" /></Card>
        <Card padding={20}><BigStat label="Net worth" value={fmt(Math.abs(netWorth), { cents: false })} color={netWorth >= 0 ? 'var(--fg-strong)' : 'var(--error)'} sign={netWorth >= 0 ? '+' : '−'} /></Card>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No accounts yet</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Connect a bank via Plaid or import a CSV to get started.
            </div>
            <Link href="/connect"><Btn variant="primary">Open connect flow</Btn></Link>
          </div>
        </Card>
      ) : KIND_ORDER.map(kind => {
        const items = groups.get(kind);
        if (!items?.length) return null;
        const groupTotal = items.reduce((s, a) => s + (a.balance ?? 0), 0);
        const liab = !isAsset(kind);
        return (
          <Card key={kind} eyebrow={kind.replace(/_/g, ' ')} title={KIND_LABELS[kind]}
                action={
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14,
                    color: liab ? 'var(--error)' : 'var(--fg-strong)',
                  }}>
                    {liab ? '−' : ''}{fmt(Math.abs(groupTotal), { cents: false })}
                  </span>
                }
                padding={0}>
            <ResizableTableShell storageKey="astroledger-cols-accounts" columns={ACCT_COLS} gap={14}>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {items.map(a => (
                <AccountRow key={a.id}
                  account={a}
                  inferred={a.kind ? a.resolvedKind : a.resolvedKind}
                  userSet={!!a.kind}
                  isLiability={liab}
                  others={accounts.filter(o => o.id !== a.id).map(o => ({
                    id: o.id, name: o.name, mask: o.mask,
                    institution: o.institution.name, txCount: o.txCount,
                  }))} />
              ))}
            </div>
            </ResizableTableShell>
          </Card>
        );
      })}
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

function AccountRow({ account, inferred, userSet, isLiability, others }: {
  account: { id: string; name: string; type: string; subtype: string | null; mask: string | null;
    balance: number | null; currency: string; kind: string | null; txCount: number;
    latestTx?: Date | null; isStale?: boolean;
    institution: { name: string; source: string; accessToken?: string | null;
      lastSyncedAt?: Date | null; lastSyncStatus?: string | null; lastSyncError?: string | null } };
  inferred: AccountKind;
  userSet: boolean;
  isLiability: boolean;
  others: Array<{ id: string; name: string; mask: string | null; institution: string; txCount: number }>;
}) {
  const balance = account.balance ?? 0;
  const inst = account.institution;
  const isLive = inst.source === 'plaid' || inst.source === 'simplefin' || inst.source === 'paypal';
  const health = isLive
    ? healthBadge({
        source: inst.source, accessToken: inst.accessToken ?? null,
        lastSyncedAt: inst.lastSyncedAt ?? null, lastSyncStatus: inst.lastSyncStatus ?? null,
        lastSyncError: inst.lastSyncError ?? null,
      })
    : null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 14, alignItems: 'center',
      padding: '14px 22px', borderBottom: '1px solid var(--border)',
      opacity: account.isStale ? 0.55 : 1,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 'var(--r-sm)',
        background: 'var(--gray-800)', color: '#fff',
        fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 14,
        display: 'grid', placeItems: 'center', border: '1px solid rgba(0,0,0,0.15)',
      }}>{account.institution.name.slice(0, 1).toUpperCase()}</div>
      <div>
        <AccountNameEdit accountId={account.id} initialName={account.name} />
        <div className="t-row-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>
            {account.institution.name} {account.mask ? <span style={{ fontFamily: 'var(--font-mono)' }}>· {account.mask}</span> : null}
            {account.subtype && <span style={{ color: 'var(--fg-subtle)' }}> · {account.subtype}</span>}
          </span>
          {health && <Pill tone={health.tone} style={{ fontSize: 8, padding: '1px 5px' }} title={health.detail}>{health.label}</Pill>}
        </div>
      </div>
      <Pill tone={account.institution.source === 'plaid' ? 'success' : account.institution.source === 'csv' ? 'info' : 'ghost'}>
        {account.institution.source}
      </Pill>
      <AccountKindSelector accountId={account.id} current={(account.kind as AccountKind | null) ?? null} inferred={inferred} />
      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16,
        color: isLiability ? 'var(--error)' : 'var(--fg-strong)' }}>
        {account.balance == null ? ' - ' : (isLiability ? '−' : '') + fmt(Math.abs(balance), { cents: false })}
      </div>
      <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Link href={`/accounts/${account.id}/reconcile`} title="Reconcile against a bank statement"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
                       borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', color: 'var(--fg-muted)',
                       textDecoration: 'none', fontSize: 14 }}>
          ⚖
        </Link>
        <AccountMergeBtn
          sourceId={account.id}
          sourceName={account.name}
          sourceMask={account.mask}
          sourceTxCount={account.txCount}
          others={others}
        />
      </div>
    </div>
  );
}
