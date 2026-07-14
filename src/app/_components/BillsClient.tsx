'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Btn, Card, ChipBtn, Pill, fmt, fmtDate } from './atoms';
import type { BillDashboard, BillOccurrenceView } from '@/lib/bills';

const CADENCES = [
  { value: 7, label: 'Weekly' },
  { value: 14, label: 'Every 2 weeks' },
  { value: 30, label: 'Monthly' },
  { value: 91, label: 'Quarterly' },
  { value: 365, label: 'Yearly' },
];

type Filter = 'attention' | 'upcoming' | 'paid' | 'all';

export default function BillsClient({ dashboard }: { dashboard: BillDashboard }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(dashboard.summary.overdueCount ? 'attention' : 'upcoming');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: '', amount: '', cadenceDays: 30, nextDate: new Date().toISOString().slice(0, 10), amountMode: 'fixed', autopay: false,
  });

  const visible = useMemo(() => dashboard.occurrences.filter(item => {
    if (filter === 'attention') return item.status === 'overdue';
    if (filter === 'upcoming') return item.status === 'upcoming' || item.status === 'overdue';
    if (filter === 'paid') return item.status === 'paid';
    return true;
  }), [dashboard.occurrences, filter]);

  async function addBill() {
    const amount = Number(draft.amount);
    if (!draft.name.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/bills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, amount }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Could not add bill');
      setDraft({ ...draft, name: '', amount: '' });
      setShowAdd(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bill');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        <Metric label="Expected next 60 days" value={`−${fmt(dashboard.summary.expected, { cents: false })}`} color="var(--fg-strong)" />
        <Metric label="Due in 7 days" value={`−${fmt(dashboard.summary.dueSoon, { cents: false })}`} color="var(--warning)" />
        <Metric label="Overdue" value={`−${fmt(dashboard.summary.overdue, { cents: false })}`} detail={`${dashboard.summary.overdueCount} item${dashboard.summary.overdueCount === 1 ? '' : 's'}`} color={dashboard.summary.overdueCount ? 'var(--error)' : 'var(--success)'} />
        <Metric label="Paid in window" value={fmt(dashboard.summary.paid, { cents: false })} detail={`${dashboard.summary.paidCount} payment${dashboard.summary.paidCount === 1 ? '' : 's'}`} color="var(--success)" />
      </div>

      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterButton active={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention ({dashboard.summary.overdueCount})</FilterButton>
            <FilterButton active={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>Upcoming</FilterButton>
            <FilterButton active={filter === 'paid'} onClick={() => setFilter('paid')}>Paid</FilterButton>
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/schedule" style={{ fontSize: 12, color: 'var(--fg-muted)', alignSelf: 'center' }}>Manage recurring activity</Link>
            <Btn variant="primary" size="sm" onClick={() => setShowAdd(v => !v)}>+ Track bill</Btn>
          </div>
        </div>
      </Card>

      {showAdd && (
        <Card eyebrow="New obligation" title="Track a recurring bill">
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 145px 145px 125px', gap: 9, alignItems: 'end' }}>
            <Field label="Bill name"><input aria-label="Bill name" placeholder="Electric, rent, insurance…" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inputStyle} /></Field>
            <Field label="Expected"><input aria-label="Expected amount" type="number" min="0.01" step="0.01" placeholder="$" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} style={inputStyle} /></Field>
            <Field label="Repeats"><select aria-label="Bill cadence" value={draft.cadenceDays} onChange={e => setDraft({ ...draft, cadenceDays: Number(e.target.value) })} style={inputStyle}>{CADENCES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
            <Field label="Next due"><input aria-label="Next due date" type="date" value={draft.nextDate} onChange={e => setDraft({ ...draft, nextDate: e.target.value })} style={inputStyle} /></Field>
            <Field label="Amount type"><select aria-label="Amount type" value={draft.amountMode} onChange={e => setDraft({ ...draft, amountMode: e.target.value })} style={inputStyle}><option value="fixed">Fixed</option><option value="variable">Variable</option></select></Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, color: 'var(--fg-muted)' }}><input type="checkbox" checked={draft.autopay} onChange={e => setDraft({ ...draft, autopay: e.target.checked })} /> Paid automatically</label>
            <div style={{ display: 'flex', gap: 8 }}><Btn size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Btn><Btn size="sm" variant="primary" disabled={busy || !draft.name.trim() || !draft.amount} onClick={addBill}>{busy ? 'Adding…' : 'Add bill'}</Btn></div>
          </div>
        </Card>
      )}

      {error && <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'var(--error-bg)', color: 'var(--error)', fontSize: 12 }}>{error}</div>}

      <Card eyebrow={`${visible.length} occurrence${visible.length === 1 ? '' : 's'}`} title={filter === 'attention' ? 'Needs attention' : filter === 'paid' ? 'Paid bills' : 'Bill timeline'} padding={0}>
        {visible.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            {filter === 'attention' ? 'Nothing is overdue.' : 'No bills in this view.'}
          </div>
        ) : visible.map(item => <BillRow key={item.id} item={item} onError={setError} />)}
      </Card>
    </div>
  );
}

function BillRow({ item, onError }: { item: BillOccurrenceView; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [candidateId, setCandidateId] = useState(item.candidates[0]?.id ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate);
  const [amount, setAmount] = useState(String(item.expectedAmount));
  const [amountMode, setAmountMode] = useState(item.amountMode);
  const [autopay, setAutopay] = useState(item.autopay);

  async function update(body: Record<string, unknown>) {
    setBusy(true); onError(null);
    try {
      const response = await fetch(`/api/bills/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Could not update bill');
      router.refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update bill');
    } finally { setBusy(false); }
  }

  const tone = item.status === 'paid' ? 'success' : item.status === 'overdue' ? 'error' : item.status === 'skipped' ? 'ghost' : 'warning';
  const sourceLabel = item.sourceType === 'subscription' ? 'detected' : item.sourceType === 'schedule' ? 'tracked' : 'one-time';

  return (
    <details style={{ borderTop: '1px solid var(--border)' }}>
      <summary style={{ display: 'grid', gridTemplateColumns: '92px minmax(180px, 1fr) 120px 120px 92px 24px', gap: 14, alignItems: 'center', padding: '14px 20px', cursor: 'pointer', listStyle: 'none' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: item.status === 'overdue' ? 'var(--error)' : 'var(--fg-muted)' }}>{fmtDate(item.dueDate)}</span>
        <span><strong style={{ display: 'block', fontSize: 13, color: 'var(--fg-strong)' }}>{item.name}</strong><span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{sourceLabel} · {item.amountMode}{item.autopay ? ' · autopay' : ''}</span></span>
        <Pill tone={tone} style={{ justifySelf: 'start' }}>{item.status}</Pill>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{item.transaction ? `${item.transaction.merchant} · ${fmtDate(item.transaction.date)}` : item.candidates.length ? `${item.candidates.length} possible match${item.candidates.length === 1 ? '' : 'es'}` : 'No payment linked'}</span>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13, textAlign: 'right' }}>−{fmt(item.expectedAmount)}</strong>
        <span style={{ color: 'var(--fg-subtle)' }}>⌄</span>
      </summary>
      <div style={{ padding: '0 20px 16px 126px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {item.transaction && (
          <div style={{ fontSize: 12, color: 'var(--success)' }}>Linked to {item.transaction.merchant} for {fmt(item.transaction.amount)} on {fmtDate(item.transaction.date)} from {item.transaction.account}.</div>
        )}
        {(item.status === 'upcoming' || item.status === 'overdue') && item.candidates.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select aria-label={`Payment match for ${item.name}`} value={candidateId} onChange={e => setCandidateId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {item.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{fmtDate(candidate.date)} · {candidate.merchant} · {fmt(candidate.amount)} · {candidate.account}</option>)}
            </select>
            <Btn size="sm" variant="success" disabled={busy || !candidateId} onClick={() => update({ status: 'paid', transactionId: candidateId })}>Link payment</Btn>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '150px 130px 130px 120px auto', gap: 9, alignItems: 'end' }}>
          <Field label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} /></Field>
          <Field label="Expected amount"><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={inputStyle} /></Field>
          <Field label="Amount type"><select value={amountMode} onChange={e => setAmountMode(e.target.value as 'fixed' | 'variable')} style={inputStyle}><option value="fixed">Fixed</option><option value="variable">Variable</option></select></Field>
          <label style={{ height: 36, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--fg-muted)' }}><input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} /> Autopay</label>
          <Btn size="sm" variant="outline" disabled={busy} onClick={() => update({ dueDate, expectedAmount: Number(amount), amountMode, autopay })}>Save details</Btn>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {(item.status === 'upcoming' || item.status === 'overdue') && <><Btn size="sm" variant="success" disabled={busy} onClick={() => update({ status: 'paid' })}>Mark paid manually</Btn><ChipBtn disabled={busy} onClick={() => update({ status: 'skipped' })}>Skip this occurrence</ChipBtn></>}
          {(item.status === 'paid' || item.status === 'skipped') && <Btn size="sm" variant="outline" disabled={busy} onClick={() => update({ status: 'upcoming' })}>Restore to upcoming</Btn>}
        </div>
      </div>
    </details>
  );
}

function Metric({ label, value, detail, color }: { label: string; value: string; detail?: string; color: string }) {
  return <Card padding={18}><div className="t-caption">{label}</div><div className="t-stat-sub" style={{ marginTop: 7, color }}>{value}</div>{detail && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--fg-subtle)' }}>{detail}</div>}</Card>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--fg-muted)', borderRadius: 999, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}>{children}</button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 'var(--tr-wide)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}{children}</label>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 9px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)', fontSize: 12, outline: 'none', minWidth: 0,
};
