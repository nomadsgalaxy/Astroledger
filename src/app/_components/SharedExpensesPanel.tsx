'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

const panel: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-elevated)', padding: 20,
};
const input: React.CSSProperties = {
  height: 38, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg)',
  color: 'var(--fg-strong)', padding: '0 10px', fontFamily: 'var(--font-body)', fontSize: 13,
};
const button: React.CSSProperties = {
  minHeight: 38, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent)',
  color: 'white', padding: '0 14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
};
const subtleButton: React.CSSProperties = { ...button, background: 'transparent', color: 'var(--fg-strong)', borderColor: 'var(--border)' };

type Member = { userId: string; name?: string | null; email: string; isCurrent: boolean };

export default function SharedExpensesPanel({ members }: { members: Member[] }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<{ transactionId: string; splitMode: string; participants: Record<string, boolean>; values: Record<string, string>; externalLabel: string }>(
    { transactionId: '', splitMode: 'equal', participants: {}, values: {}, externalLabel: '' },
  );
  const [settling, setSettling] = useState<string | null>(null); // shareId with the link picker open

  const load = async () => {
    const response = await fetch('/api/shared-expenses', { cache: 'no-store' });
    if (response.ok) setData(await response.json());
  };
  useEffect(() => { load(); }, []);

  const usersById = useMemo(() => new Map<string, any>((data?.users ?? []).map((user: any) => [user.id, user])), [data]);
  const me = members.find(member => member.isCurrent);

  const post = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label); setMessage('');
    try {
      const response = await fetch('/api/shared-expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');
      setData(result);
      return true;
    } catch (error: any) { setMessage(error.message); return false; }
    finally { setBusy(''); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const shares: any[] = members
      .filter(member => form.participants[member.userId])
      .map(member => ({
        userId: member.userId,
        ...(form.splitMode === 'percentage' ? { percentage: Number(form.values[member.userId] ?? 0) } : {}),
        ...(form.splitMode === 'fixed' || form.splitMode === 'custom' ? { amount: Number(form.values[member.userId] ?? 0) } : {}),
      }));
    if (form.externalLabel.trim()) {
      shares.push({
        label: form.externalLabel.trim(),
        ...(form.splitMode === 'percentage' ? { percentage: Number(form.values.__external ?? 0) } : {}),
        ...(form.splitMode === 'fixed' || form.splitMode === 'custom' ? { amount: Number(form.values.__external ?? 0) } : {}),
      });
    }
    if (await post({ action: 'create', transactionId: form.transactionId, splitMode: form.splitMode, shares }, 'Splitting')) {
      setForm({ transactionId: '', splitMode: 'equal', participants: {}, values: {}, externalLabel: '' });
    }
  };

  if (!data) return null;
  const needsValues = form.splitMode !== 'equal';
  const participantRows = [
    ...members.filter(member => form.participants[member.userId]).map(member => ({ key: member.userId, label: member.name || member.email })),
    ...(form.externalLabel.trim() ? [{ key: '__external', label: form.externalLabel.trim() }] : []),
  ];

  return (
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 17 }}>Split expenses</h2>
      <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
        Split a real charge across people without duplicating the transaction. Reimbursements you link at settlement are excluded from income.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ ...subtleButton, cursor: 'default', display: 'inline-flex', alignItems: 'center' }}>You owe: {data.summary.youOwe.toFixed(2)}</span>
        <span style={{ ...subtleButton, cursor: 'default', display: 'inline-flex', alignItems: 'center' }}>Owed to you: {data.summary.owedToYou.toFixed(2)}</span>
      </div>
      {(busy || message) && <div role="status" style={{ color: message ? 'var(--negative)' : 'var(--fg-muted)', fontSize: 13, marginBottom: 8 }}>{busy ? `${busy}…` : message}</div>}

      {!!data.candidates?.length && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 8, marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <select style={{ ...input, flex: '2 1 260px' }} required value={form.transactionId} onChange={event => setForm({ ...form, transactionId: event.target.value })}>
              <option value="">Charge to split…</option>
              {data.candidates.map((tx: any) => (
                <option key={tx.id} value={tx.id}>
                  {new Date(tx.date).toLocaleDateString()} · {tx.merchant ?? tx.rawDescription} · {Math.abs(tx.amount).toFixed(2)}
                </option>
              ))}
            </select>
            <select style={input} value={form.splitMode} onChange={event => setForm({ ...form, splitMode: event.target.value })}>
              <option value="equal">split equally</option>
              <option value="percentage">by percentage</option>
              <option value="fixed">by fixed amounts</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {members.map(member => (
              <label key={member.userId} style={{ fontSize: 12 }}>
                <input type="checkbox" checked={!!form.participants[member.userId]}
                  onChange={event => setForm({ ...form, participants: { ...form.participants, [member.userId]: event.target.checked } })} />
                {' '}{member.name || member.email}{member.isCurrent ? ' (you)' : ''}
              </label>
            ))}
            <input style={{ ...input, height: 30, flex: '1 1 160px' }} placeholder="Someone outside the space (optional)"
              value={form.externalLabel} onChange={event => setForm({ ...form, externalLabel: event.target.value })} />
          </div>
          {needsValues && participantRows.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {participantRows.map(row => (
                <label key={row.key} style={{ fontSize: 12 }}>
                  {row.label}{' '}
                  <input style={{ ...input, height: 30, width: 90 }} type="number" step="0.01" min="0"
                    placeholder={form.splitMode === 'percentage' ? '%' : 'amount'}
                    value={form.values[row.key] ?? ''}
                    onChange={event => setForm({ ...form, values: { ...form.values, [row.key]: event.target.value } })} />
                </label>
              ))}
            </div>
          )}
          <button style={{ ...button, justifySelf: 'start' }} disabled={!!busy}>Split expense</button>
        </form>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {data.expenses.map((expense: any) => (
          <div key={expense.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--bg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 13 }}>{expense.transaction?.merchant ?? expense.transaction?.rawDescription ?? 'Charge'}</strong>
                <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                  {' '}· {expense.transaction ? Math.abs(expense.transaction.amount).toFixed(2) : ''} · {expense.splitMode} · {expense.status}
                </span>
              </div>
              {(expense.paidById === me?.userId) && (
                <button style={{ border: 0, background: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => confirm('Remove this split?') && post({ action: 'delete', expenseId: expense.id }, 'Removing')}>remove</button>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {expense.shares.map((share: any) => (
                <div key={share.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 160 }}>{share.userId ? (usersById.get(share.userId)?.name ?? usersById.get(share.userId)?.email ?? 'Member') : share.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{share.amount.toFixed(2)}</span>
                  {share.settledAt
                    ? <span style={{ color: 'var(--positive, #3a9)' }}>settled{share.settlementTransactionId ? ' · linked' : ''}
                        <button style={{ border: 0, background: 'none', color: 'var(--fg-subtle)', cursor: 'pointer', fontSize: 11 }}
                          onClick={() => post({ action: 'reopen', shareId: share.id }, 'Reopening')}>undo</button>
                      </span>
                    : settling === share.id
                      ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <select style={{ ...input, height: 28 }} defaultValue="" id={`settle-${share.id}`}>
                            <option value="">no linked reimbursement</option>
                            {(data.settleCandidates ?? []).map((tx: any) => (
                              <option key={tx.id} value={tx.id}>{new Date(tx.date).toLocaleDateString()} · +{tx.amount.toFixed(2)} · {tx.merchant ?? tx.rawDescription}</option>
                            ))}
                          </select>
                          <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => {
                            const linked = (document.getElementById(`settle-${share.id}`) as HTMLSelectElement)?.value;
                            post({ action: 'settle', shareId: share.id, settlementTransactionId: linked || undefined }, 'Settling');
                            setSettling(null);
                          }}>confirm</button>
                          <button style={{ border: 0, background: 'none', color: 'var(--fg-subtle)', cursor: 'pointer', fontSize: 11 }} onClick={() => setSettling(null)}>cancel</button>
                        </span>
                      : <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => setSettling(share.id)}>settle</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {!data.expenses.length && <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No shared expenses yet.</p>}
      </div>
    </section>
  );
}
