'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Btn, Pill, fmt, fmtDate } from './atoms';

type Txn = {
  id: string; date: string; merchant: string | null; rawDescription: string | null;
  amount: number; cleared: boolean; locked: boolean;
};

type Props = {
  accountId: string;
  accountName: string;
  currency: string;
  bookBalance: number;
  initialClearedBalance: number;
  reconciledBalance: number;
  lockedCount: number;
  olderUnclearedCount: number;
  reconciledAsOf: string | null;
  txns: Txn[];
};

export default function ReconcileClient(props: Props) {
  const router = useRouter();
  const [txns, setTxns] = useState<Txn[]>(props.txns);
  const [clearedBalance, setClearedBalance] = useState(props.initialClearedBalance);
  const [statementInput, setStatementInput] = useState<string>('');
  const [statementDate, setStatementDate] = useState<string>(
    props.reconciledAsOf ? props.reconciledAsOf.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [confirmAdjust, setConfirmAdjust] = useState(false);

  const statementBalance = statementInput.trim() === '' ? null : Number(statementInput);
  const statementValid = statementBalance != null && Number.isFinite(statementBalance);
  const difference = useMemo(
    () => (statementValid ? Math.round((statementBalance! - clearedBalance) * 100) / 100 : null),
    [statementValid, statementBalance, clearedBalance]
  );
  const tiesOut = difference != null && Math.abs(difference) < 0.005;

  async function toggle(tx: Txn) {
    if (tx.locked || busyId) return; // locked rows are immutable here
    const next = !tx.cleared;
    // optimistic
    setTxns(ts => ts.map(t => (t.id === tx.id ? { ...t, cleared: next } : t)));
    setClearedBalance(b => Math.round((b + (next ? tx.amount : -tx.amount)) * 100) / 100);
    setBusyId(tx.id);
    setMsg(null);
    setConfirmAdjust(false);
    try {
      const r = await fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleared: next }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      // rollback
      setTxns(ts => ts.map(t => (t.id === tx.id ? { ...t, cleared: !next } : t)));
      setClearedBalance(b => Math.round((b + (next ? -tx.amount : tx.amount)) * 100) / 100);
      setMsg({ tone: 'err', text: `Couldn't update: ${(e as Error).message}` });
    } finally {
      setBusyId(null);
    }
  }

  async function lock(createAdjustment: boolean) {
    if (!statementValid || locking) return;
    setLocking(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/accounts/${props.accountId}/reconciliation/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementBalance, statementDate, createAdjustment }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === 'OUT_OF_BALANCE') {
          setConfirmAdjust(true);
          setMsg({ tone: 'info', text: `Off by ${fmt(j.difference, { sign: true })}. Create a balancing adjustment and lock anyway?` });
        } else {
          setMsg({ tone: 'err', text: j.error ?? r.statusText });
        }
        return;
      }
      const adjNote = j.adjustmentId ? ' (balancing adjustment created)' : '';
      setMsg({ tone: 'ok', text: `Reconciled — locked ${j.lockedCount} transaction${j.lockedCount === 1 ? '' : 's'} as of ${statementDate}${adjNote}.` });
      setConfirmAdjust(false);
      // Refresh server state so locked rows + reconciledAsOf reflect reality.
      router.refresh();
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message });
    } finally {
      setLocking(false);
    }
  }

  const diffColor = tiesOut ? 'var(--success)' : 'var(--error)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card eyebrow="Step 1" title="Enter your statement balance">
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          Type the <strong>ending balance</strong> from your latest bank or card statement, then check off
          each transaction below until the difference reaches zero. Cleared rows are summed and compared
          against the number you enter.
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
            Statement ending balance ({props.currency})
            <input
              type="number" inputMode="decimal" step="0.01" value={statementInput}
              onChange={e => { setStatementInput(e.target.value); setConfirmAdjust(false); }}
              placeholder="0.00"
              style={{
                width: 180, padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 15,
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                background: 'var(--bg-panel)', color: 'var(--fg-strong)',
              }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
            Statement closing date
            <input
              type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)}
              style={{
                padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 14,
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                background: 'var(--bg-panel)', color: 'var(--fg-strong)',
              }} />
          </label>
        </div>
      </Card>

      <Card eyebrow="Reconciliation" title="Balance summary" padding={0}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', borderTop: '1px solid var(--border)' }}>
          <Stat label="Book balance" value={fmt(props.bookBalance, { sign: true })} hint="Every transaction in this account" />
          <Stat label="Cleared balance" value={fmt(clearedBalance, { sign: true })} hint={`${txns.filter(t => t.cleared).length} shown cleared`} />
          <Stat label="Statement balance" value={statementValid ? fmt(statementBalance!, { sign: true }) : '—'} hint="What you entered" />
          <Stat label="Difference" value={difference != null ? fmt(difference, { sign: true }) : '—'} color={difference != null ? diffColor : undefined}
                hint={difference != null ? (tiesOut ? 'Ties out ✓' : 'Keep clearing rows') : 'Enter a balance'} />
        </div>
      </Card>

      <Card eyebrow="Step 2" title="Check off cleared transactions"
            action={tiesOut
              ? <Btn variant="success" size="md" disabled={locking} onClick={() => lock(false)}>{locking ? 'Locking…' : 'Lock reconciliation'}</Btn>
              : (statementValid
                  ? <Btn variant="outline" size="md" disabled={locking} onClick={() => (confirmAdjust ? lock(true) : lock(false))}>
                      {locking ? 'Locking…' : confirmAdjust ? 'Create adjustment & lock' : 'Lock…'}
                    </Btn>
                  : undefined)}
            padding={0}>
        {msg && (
          <div style={{
            margin: '12px 22px 0', padding: '8px 12px', fontSize: 12, borderRadius: 'var(--r-sm)',
            background: msg.tone === 'err' ? 'rgba(237,0,0,.08)' : msg.tone === 'ok' ? 'rgba(101,201,0,.10)' : 'rgba(52,110,244,.08)',
            color: msg.tone === 'err' ? 'var(--error)' : msg.tone === 'ok' ? 'var(--success)' : 'var(--link)',
          }}>{msg.text}</div>
        )}
        <div style={{ padding: '10px 22px', fontSize: 11, color: 'var(--fg-subtle)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>{props.lockedCount} already locked</span>
          {props.reconciledAsOf && <span>· last reconciled {fmtDate(props.reconciledAsOf)}</span>}
          {props.olderUnclearedCount > 0 && <span>· {props.olderUnclearedCount} older uncleared not shown</span>}
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {txns.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>No transactions in this account.</div>
          ) : txns.map(t => (
            <div key={t.id}
                 onClick={() => toggle(t)}
                 style={{
                   display: 'grid', gridTemplateColumns: '28px 70px 1fr 120px', gap: 12, alignItems: 'center',
                   padding: '11px 22px', borderBottom: '1px solid var(--border)',
                   cursor: t.locked ? 'default' : 'pointer',
                   opacity: t.locked ? 0.6 : 1,
                   background: t.cleared && !t.locked ? 'rgba(101,201,0,.05)' : 'transparent',
                 }}>
              <input type="checkbox" checked={t.cleared} readOnly disabled={t.locked || busyId === t.id}
                     style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: t.locked ? 'default' : 'pointer' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{fmtDate(t.date)}</span>
              <span style={{ fontSize: 13, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.merchant || t.rawDescription || '—'}
                {t.locked && <Pill tone="ghost" style={{ marginLeft: 8, fontSize: 8 }} title="Locked by a prior reconciliation">🔒 locked</Pill>}
              </span>
              <span style={{ justifySelf: 'end', fontFamily: 'var(--font-mono)', fontSize: 13, color: t.amount < 0 ? 'var(--fg-strong)' : 'var(--success)' }}>
                {fmt(t.amount, { sign: true })}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={{ padding: '16px 20px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <div className="t-caption">{label}</div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600, color: color ?? 'var(--fg-strong)' }}>{value}</div>
      {hint && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--fg-subtle)' }}>{hint}</div>}
    </div>
  );
}
