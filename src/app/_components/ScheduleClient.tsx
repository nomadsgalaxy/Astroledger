'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Btn, Pill, ChipBtn, fmt, fmtDate } from './atoms';
import type { MonthlyCommitments, ScheduleEvent } from '@/lib/schedule';

type Sched = { id: string; name: string; amount: number; cadenceDays: number; nextDate: string; active: boolean };

const CADENCES = [{ d: 7, l: 'Weekly' }, { d: 14, l: 'Biweekly' }, { d: 30, l: 'Monthly' }, { d: 91, l: 'Quarterly' }, { d: 365, l: 'Yearly' }];
function cadenceLabel(d: number) { return CADENCES.find(c => c.d === d)?.l ?? `${d}d`; }

export default function ScheduleClient({ initialSchedules, commitments, upcoming }: { initialSchedules: Sched[]; commitments: MonthlyCommitments; upcoming: ScheduleEvent[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', amount: '', sign: '-' as '+' | '-', cadence: 30, nextDate: new Date().toISOString().slice(0, 10) });

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true);
    try { const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (r.ok) router.refresh(); }
    finally { setBusy(false); }
  }
  async function add() {
    const amt = parseFloat(draft.amount); if (!draft.name.trim() || !Number.isFinite(amt) || amt === 0) return;
    const amount = draft.sign === '-' ? -Math.abs(amt) : Math.abs(amt);
    await call('POST', '/api/schedule', { name: draft.name.trim(), amount, cadenceDays: draft.cadence, nextDate: draft.nextDate });
    setDraft({ ...draft, name: '', amount: '' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <Card padding={20}><Stat label="Recurring in / mo" value={`+${fmt(commitments.recurringIn, { cents: false })}`} color="var(--success)" /></Card>
        <Card padding={20}><Stat label="Recurring out / mo" value={`−${fmt(commitments.recurringOut, { cents: false })}`} color="var(--error)" /></Card>
        <Card padding={20}><Stat label="Net recurring / mo" value={`${commitments.net >= 0 ? '+' : '−'}${fmt(Math.abs(commitments.net), { cents: false })}`} color={commitments.net >= 0 ? 'var(--fg-strong)' : 'var(--error)'} /></Card>
      </div>

      <Card eyebrow={`Next 60 days · ${upcoming.length} event${upcoming.length === 1 ? '' : 's'}`} title="Upcoming" padding={0}>
        {upcoming.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Nothing scheduled in the next 60 days.</div>
        ) : (
          <div style={{ borderTop: '1px solid var(--border)', maxHeight: 320, overflowY: 'auto' }}>
            {upcoming.slice(0, 60).map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr auto 90px', gap: 12, alignItems: 'center', padding: '9px 22px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{fmtDate(e.date)}</span>
                <span style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{e.name}</span>
                <Pill tone={e.source === 'subscription' ? 'info' : 'default'} style={{ fontSize: 8 }}>{e.source}</Pill>
                <span style={{ justifySelf: 'end', fontFamily: 'var(--font-mono)', fontSize: 12, color: e.amount >= 0 ? 'var(--success)' : 'var(--error)' }}>{e.amount >= 0 ? '+' : '−'}{fmt(Math.abs(e.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card eyebrow={`Manual entries · ${initialSchedules.length}`} title="Recurring income & bills you track" padding={0}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {initialSchedules.length === 0 && <div style={{ padding: 18, fontSize: 12, color: 'var(--fg-subtle)' }}>No manual entries yet. Add a paycheck, rent, or a quarterly bill below — it'll show up in Upcoming and the cashflow forecast.</div>}
          {initialSchedules.map(s => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px auto', gap: 12, alignItems: 'center', padding: '11px 22px', borderBottom: '1px solid var(--border)', opacity: s.active ? 1 : 0.5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{s.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: s.amount >= 0 ? 'var(--success)' : 'var(--error)' }}>{s.amount >= 0 ? '+' : '−'}{fmt(Math.abs(s.amount))}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{cadenceLabel(s.cadenceDays)} · {fmtDate(s.nextDate)}</span>
              <span style={{ justifySelf: 'end', display: 'flex', gap: 6 }}>
                <Btn variant={s.active ? 'outline' : 'success'} size="sm" disabled={busy} onClick={() => call('PATCH', `/api/schedule/${s.id}`, { active: !s.active })}>{s.active ? 'Pause' : 'Resume'}</Btn>
                <ChipBtn tone="danger" disabled={busy} onClick={() => call('DELETE', `/api/schedule/${s.id}`)}>✕</ChipBtn>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card eyebrow="New" title="Add a recurring entry">
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 100px 140px 130px auto', gap: 8, alignItems: 'center' }}>
          <input placeholder="Name (e.g. Paycheck, Rent)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inp} />
          <select value={draft.sign} onChange={e => setDraft({ ...draft, sign: e.target.value as '+' | '-' })} style={inp}><option value="-">− expense</option><option value="+">+ income</option></select>
          <input type="number" min="0" step="10" placeholder="$" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} style={inp} />
          <select value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: Number(e.target.value) })} style={inp}>{CADENCES.map(c => <option key={c.d} value={c.d}>{c.l}</option>)}</select>
          <input type="date" value={draft.nextDate} onChange={e => setDraft({ ...draft, nextDate: e.target.value })} style={inp} />
          <Btn variant="primary" disabled={busy} onClick={add}>+ Add</Btn>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (<div><div className="t-caption">{label}</div><div className="t-stat-sub" style={{ marginTop: 8, color }}>{value}</div></div>);
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
