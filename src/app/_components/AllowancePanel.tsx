'use client';

import { FormEvent, useEffect, useState } from 'react';

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
const dangerLink: React.CSSProperties = { border: 0, background: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 12 };

type Member = { userId: string; name?: string | null; email: string; isCurrent: boolean };
type Account = { id: string; name: string; accessLevel: string };

export default function AllowancePanel({ members, accounts }: { members: Member[]; accounts: Account[] }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [rule, setRule] = useState({ name: '', amount: '', cadenceDays: '7', nextDate: new Date().toISOString().slice(0, 10), accountId: '', autoApprove: false });
  const [chore, setChore] = useState({ name: '', reward: '', assigneeUserId: '', accountId: '' });

  const manageAccounts = accounts.filter(account => ['manage', 'owner'].includes(account.accessLevel));

  const load = async () => {
    const response = await fetch('/api/allowances', { cache: 'no-store' });
    if (response.ok) setData(await response.json());
  };
  useEffect(() => { load(); }, []);

  const post = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label); setMessage('');
    try {
      const response = await fetch('/api/allowances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');
      setData(result);
      return true;
    } catch (error: any) { setMessage(error.message); return false; }
    finally { setBusy(''); }
  };

  const saveRule = async (event: FormEvent) => {
    event.preventDefault();
    if (await post({ action: 'save_rule', ...rule, amount: Number(rule.amount), cadenceDays: Number(rule.cadenceDays) }, 'Saving')) {
      setRule({ ...rule, name: '', amount: '' });
    }
  };

  const saveChore = async (event: FormEvent) => {
    event.preventDefault();
    if (await post({ action: 'create_chore', ...chore, reward: Number(chore.reward), assigneeUserId: chore.assigneeUserId || undefined, accountId: chore.accountId || undefined }, 'Adding chore')) {
      setChore({ ...chore, name: '', reward: '' });
    }
  };

  if (!data) return null;
  const canManage = !!data.canManage;
  const memberName = (userId: string | null) => {
    const member = members.find(item => item.userId === userId);
    return member ? (member.name || member.email) : '—';
  };
  const pendingPayouts = data.payouts.filter((payout: any) => payout.status === 'pending');
  const openChores = data.chores.filter((item: any) => item.status === 'open');
  const doneChores = data.chores.filter((item: any) => item.status === 'done_pending');
  const paidChores = data.chores.filter((item: any) => item.status === 'paid');
  const me = members.find(member => member.isCurrent);

  return (
    <section style={{ ...panel, borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))' }}>
      <h2 style={{ marginTop: 0, fontSize: 17 }}>{canManage ? 'Allowance & chores' : 'Your money'}</h2>
      {!canManage && <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
        Finish a chore and mark it done — your guardian approves it and the money lands in your account. Allowances arrive on their own schedule.
      </p>}
      {(busy || message) && <div role="status" style={{ color: message ? 'var(--negative)' : 'var(--fg-muted)', fontSize: 13, marginBottom: 8 }}>{busy ? `${busy}…` : message}</div>}

      {canManage && (
        <form onSubmit={saveRule} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <input style={{ ...input, flex: '1 1 170px' }} placeholder="Allowance name" required value={rule.name} onChange={event => setRule({ ...rule, name: event.target.value })} />
          <input style={{ ...input, width: 100 }} type="number" step="0.01" min="0.01" placeholder="Amount" required value={rule.amount} onChange={event => setRule({ ...rule, amount: event.target.value })} />
          <label style={{ fontSize: 12, alignSelf: 'center' }}>every <input style={{ ...input, width: 64, height: 32 }} type="number" min="1" value={rule.cadenceDays} onChange={event => setRule({ ...rule, cadenceDays: event.target.value })} /> days</label>
          <input style={input} type="date" value={rule.nextDate} onChange={event => setRule({ ...rule, nextDate: event.target.value })} required />
          <select style={input} required value={rule.accountId} onChange={event => setRule({ ...rule, accountId: event.target.value })}>
            <option value="">Pay into…</option>
            {manageAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <label style={{ fontSize: 12, alignSelf: 'center' }}><input type="checkbox" checked={rule.autoApprove} onChange={event => setRule({ ...rule, autoApprove: event.target.checked })} /> auto-approve</label>
          <button style={button} disabled={!!busy}>Add allowance</button>
        </form>
      )}

      {!!data.rules.length && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {data.rules.map((item: any) => (
            <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, flexWrap: 'wrap' }}>
              <strong>{item.name}</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                {item.amount.toFixed(2)} every {item.cadenceDays}d · next {new Date(item.nextDate).toLocaleDateString()} · {item.autoApprove ? 'auto-approves' : 'needs approval'}{item.active ? '' : ' · paused'}
              </span>
              {canManage && <>
                <button style={{ border: 0, background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => post({ action: 'save_rule', id: item.id, name: item.name, amount: item.amount, cadenceDays: item.cadenceDays, nextDate: item.nextDate, accountId: item.accountId, autoApprove: item.autoApprove, active: !item.active }, 'Updating')}>
                  {item.active ? 'pause' : 'resume'}
                </button>
                <button style={dangerLink} onClick={() => confirm(`Remove "${item.name}"? Paid history stays on the ledger.`) && post({ action: 'delete_rule', ruleId: item.id }, 'Removing')}>remove</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {!!pendingPayouts.length && (
        <div style={{ marginBottom: 14 }}>
          <div className="t-caption" style={{ marginBottom: 6 }}>AWAITING APPROVAL</div>
          {pendingPayouts.map((payout: any) => (
            <div key={payout.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, marginBottom: 6, flexWrap: 'wrap' }}>
              <span>{payout.rule?.name ?? 'Allowance'} · {payout.amount.toFixed(2)} · due {new Date(payout.dueDate).toLocaleDateString()}</span>
              {canManage && <>
                <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => post({ action: 'decide_payout', payoutId: payout.id, decision: 'approve' }, 'Paying')}>Pay</button>
                <button style={dangerLink} onClick={() => post({ action: 'decide_payout', payoutId: payout.id, decision: 'reject' }, 'Skipping')}>skip</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form onSubmit={saveChore} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <input style={{ ...input, flex: '1 1 190px' }} placeholder="Chore or goal (e.g. Rake the leaves)" required value={chore.name} onChange={event => setChore({ ...chore, name: event.target.value })} />
          <input style={{ ...input, width: 100 }} type="number" step="0.01" min="0.01" placeholder="Reward" required value={chore.reward} onChange={event => setChore({ ...chore, reward: event.target.value })} />
          <select style={input} value={chore.assigneeUserId} onChange={event => setChore({ ...chore, assigneeUserId: event.target.value })}>
            <option value="">Anyone in this space</option>
            {members.map(member => <option key={member.userId} value={member.userId}>{member.name || member.email}</option>)}
          </select>
          <select style={input} value={chore.accountId} onChange={event => setChore({ ...chore, accountId: event.target.value })}>
            <option value="">Payout account at approval…</option>
            {manageAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <button style={button} disabled={!!busy}>Add chore</button>
        </form>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {doneChores.map((item: any) => (
          <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
            <span>✔ <strong>{item.name}</strong> marked done by {memberName(item.assigneeUserId)} · pays {item.reward.toFixed(2)}</span>
            {canManage && <>
              <select style={{ ...input, height: 30 }} id={`chore-account-${item.id}`} defaultValue={item.accountId ?? ''}>
                <option value="">Payout account…</option>
                {manageAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => {
                const accountId = (document.getElementById(`chore-account-${item.id}`) as HTMLSelectElement)?.value;
                post({ action: 'decide_chore', choreId: item.id, decision: 'approve', accountId: accountId || undefined }, 'Paying');
              }}>Approve & pay</button>
              <button style={dangerLink} onClick={() => post({ action: 'decide_chore', choreId: item.id, decision: 'reject' }, 'Returning')}>needs work</button>
            </>}
          </div>
        ))}
        {openChores.map((item: any) => (
          <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
            <span><strong>{item.name}</strong> · earns {item.reward.toFixed(2)} · {item.assigneeUserId ? `for ${memberName(item.assigneeUserId)}` : 'up for grabs'}</span>
            {(!item.assigneeUserId || item.assigneeUserId === me?.userId || canManage) && (
              <button style={{ ...subtleButton, minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => post({ action: 'claim_chore', choreId: item.id }, 'Marking done')}>Mark done</button>
            )}
            {canManage && <button style={dangerLink} onClick={() => post({ action: 'delete_chore', choreId: item.id }, 'Removing')}>remove</button>}
          </div>
        ))}
        {!!paidChores.length && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 6 }}>
            Recently earned: {paidChores.slice(0, 5).map((item: any) => `${item.name} (+${item.reward.toFixed(2)})`).join(' · ')}
          </div>
        )}
        {!data.chores.length && !data.rules.length && <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No allowances or chores here yet.</p>}
      </div>
    </section>
  );
}
