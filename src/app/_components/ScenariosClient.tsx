'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Btn, Pill, ChipBtn, fmt } from './atoms';
import type { ScenarioRunway } from '@/lib/scenarios';

type Adj = { id: string; label: string; monthlyDelta: number };
type Scenario = { id: string; name: string; active: boolean; adjustments: Adj[] };

function runwayLabel(r: ScenarioRunway): { headline: string; tone: 'success' | 'error' | 'warning'; detail: string } {
  if (r.status === 'growing') {
    return { headline: `+${fmt(r.annualChange, { cents: false })}/yr`, tone: 'success', detail: `Net positive — savings grow about ${fmt(r.monthlyNet, { cents: false })}/mo.` };
  }
  if (r.status === 'flat') return { headline: 'Steady', tone: 'warning', detail: 'Roughly break-even month to month.' };
  const m = r.runwayMonths ?? 0;
  const y = Math.floor(m / 12), mo = m % 12;
  const dur = [y ? `${y}y` : '', mo ? `${mo}mo` : ''].filter(Boolean).join(' ') || '<1mo';
  return { headline: `${dur} of runway`, tone: m < 6 ? 'error' : 'warning', detail: `Spending ${fmt(Math.abs(r.monthlyNet), { cents: false })}/mo more than you earn — savings reach $0 around ${r.depletionDate}.` };
}

export default function ScenariosClient({ initialScenarios, initialRunway }: { initialScenarios: Scenario[]; initialRunway: ScenarioRunway }) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [runway, setRunway] = useState(initialRunway);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [adjDraft, setAdjDraft] = useState<Record<string, { label: string; amount: string; sign: '+' | '-' }>>({});

  async function refresh() {
    const r = await fetch('/api/scenarios');
    if (r.ok) { const j = await r.json(); setScenarios(j.scenarios.map((s: any) => ({ id: s.id, name: s.name, active: s.active, adjustments: s.adjustments }))); setRunway(j.runway); }
  }
  async function call(method: string, url: string, body?: unknown) {
    setBusy(true);
    try { const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (r.ok) await refresh(); }
    finally { setBusy(false); }
  }

  async function addScenario() {
    if (!newName.trim()) return;
    await call('POST', '/api/scenarios', { name: newName.trim() });
    setNewName('');
  }
  async function addAdjustment(sid: string) {
    const d = adjDraft[sid]; if (!d?.label.trim()) return;
    const amt = parseFloat(d.amount); if (!Number.isFinite(amt)) return;
    const monthlyDelta = d.sign === '-' ? -Math.abs(amt) : Math.abs(amt);
    await call('POST', `/api/scenarios/${sid}/adjustments`, { label: d.label.trim(), monthlyDelta });
    setAdjDraft(s => ({ ...s, [sid]: { label: '', amount: '', sign: '-' } }));
  }

  const rl = runwayLabel(runway);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Headline runway */}
      <Card eyebrow="Headline runway · baseline + active scenarios" title="Savings trajectory"
            action={<Pill tone={rl.tone}>{rl.headline}</Pill>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 16, marginBottom: 14 }}>
          <Stat label="Liquid savings now" value={fmt(runway.liquidStart, { cents: false })} />
          <Stat label="Baseline net / mo" value={`${runway.baseMonthlyNet >= 0 ? '+' : '−'}${fmt(Math.abs(runway.baseMonthlyNet), { cents: false })}`} color={runway.baseMonthlyNet >= 0 ? 'var(--success)' : 'var(--error)'} />
          {runway.appliedDelta !== 0 && <Stat label="Active scenario impact" value={`${runway.appliedDelta >= 0 ? '+' : '−'}${fmt(Math.abs(runway.appliedDelta), { cents: false })}`} color={runway.appliedDelta >= 0 ? 'var(--success)' : 'var(--error)'} />}
          <Stat label="Net / mo (applied)" value={`${runway.monthlyNet >= 0 ? '+' : '−'}${fmt(Math.abs(runway.monthlyNet), { cents: false })}`} color={runway.monthlyNet >= 0 ? 'var(--success)' : 'var(--error)'} />
        </div>
        <RunwayChart projection={runway.projection} liquidStart={runway.liquidStart} />
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 10, lineHeight: 1.5 }}>
          {rl.detail} <span style={{ color: 'var(--fg-subtle)' }}>(baseline from {runway.source === 'forecast' ? 'your forecast' : runway.source === 'actuals' ? 'recent 3-month average' : 'no data yet'})</span>
        </div>
      </Card>

      {/* Scenarios */}
      {scenarios.map(s => {
        const impact = s.adjustments.reduce((sum, a) => sum + a.monthlyDelta, 0);
        const d = adjDraft[s.id] ?? { label: '', amount: '', sign: '-' as const };
        return (
          <Card key={s.id} eyebrow={s.active ? 'Active · in headline' : 'Inactive'} title={s.name}
                action={
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Pill tone={impact >= 0 ? 'success' : 'error'}>{impact >= 0 ? '+' : '−'}{fmt(Math.abs(impact), { cents: false })}/mo</Pill>
                    <Btn variant={s.active ? 'success' : 'outline'} size="sm" disabled={busy} onClick={() => call('PATCH', `/api/scenarios/${s.id}`, { active: !s.active })}>{s.active ? '✓ Active' : 'Activate'}</Btn>
                    <ChipBtn tone="danger" disabled={busy} onClick={() => call('DELETE', `/api/scenarios/${s.id}`)}>✕</ChipBtn>
                  </div>
                }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {s.adjustments.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>No adjustments yet — add a what-if below.</div>}
              {s.adjustments.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--fg)' }}>{a.label}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: a.monthlyDelta >= 0 ? 'var(--success)' : 'var(--error)' }}>{a.monthlyDelta >= 0 ? '+' : '−'}{fmt(Math.abs(a.monthlyDelta))}/mo</span>
                    <ChipBtn tone="default" disabled={busy} onClick={() => call('DELETE', `/api/scenarios/${s.id}/adjustments?adj=${a.id}`)}>✕</ChipBtn>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input placeholder="What-if (e.g. $500 raise)" value={d.label} onChange={e => setAdjDraft(st => ({ ...st, [s.id]: { ...d, label: e.target.value } }))} style={{ ...inp, flex: 1, minWidth: 160 }} />
              <select value={d.sign} onChange={e => setAdjDraft(st => ({ ...st, [s.id]: { ...d, sign: e.target.value as '+' | '-' } }))} style={{ ...inp, width: 130 }}>
                <option value="-">− cost / less</option>
                <option value="+">+ income / save</option>
              </select>
              <input type="number" min="0" step="10" placeholder="$/mo" value={d.amount} onChange={e => setAdjDraft(st => ({ ...st, [s.id]: { ...d, amount: e.target.value } }))} style={{ ...inp, width: 100 }} />
              <Btn variant="primary" size="sm" disabled={busy} onClick={() => addAdjustment(s.id)}>+ Add</Btn>
            </div>
          </Card>
        );
      })}

      <Card eyebrow="New scenario" title="Model a change">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Scenario name (e.g. Move to a cheaper apartment)" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addScenario(); }} style={{ ...inp, flex: 1 }} />
          <Btn variant="primary" disabled={busy || !newName.trim()} onClick={addScenario}>+ Create</Btn>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: color ?? 'var(--fg-strong)' }}>{value}</div>
    </div>
  );
}

function RunwayChart({ projection, liquidStart }: { projection: Array<{ month: string; balance: number }>; liquidStart: number }) {
  const pts = [{ month: 'now', balance: liquidStart }, ...projection];
  if (pts.length < 2) return null;
  const W = 1200, H = 160, padL = 56, padR = 16, padT = 12, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = pts.map(p => p.balance);
  const max = Math.max(...vals, 0) * 1.05;
  const min = Math.min(...vals, 0) * 1.05;
  const px = (i: number) => padL + (i / (pts.length - 1)) * innerW;
  const py = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(p.balance)}`).join(' ');
  const ends = liquidStart < pts[pts.length - 1].balance;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {min < 0 && <line x1={padL} x2={W - padR} y1={py(0)} y2={py(0)} stroke="var(--fg-muted)" opacity="0.5" />}
      <path d={line} fill="none" stroke={ends ? 'var(--success)' : 'var(--error)'} strokeWidth="2.5" />
      <text x={padL - 8} y={py(max)} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(max, { cents: false })}</text>
      <text x={padL - 8} y={py(min) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(min, { cents: false })}</text>
    </svg>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
