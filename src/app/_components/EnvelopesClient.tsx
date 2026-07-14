'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Btn, Pill, ChipBtn, ProgressBar, fmt } from './atoms';
import { ResizableTableShell } from './useResizableColumns';
import type { EnvelopeProgress, ReadyToAssign } from '@/lib/envelopes';

type TagRef = { id: string; name: string; parentName: string | null };
type CatRef = { id: string; name: string };

const ENV_COLS = [
  { key: 'name',      flex: 1,    min: 180 },
  { key: 'scope',     width: 180, min: 140 },
  { key: 'alloc',     width: 110, min: 90 },
  { key: 'spent',     width: 110, min: 90 },
  { key: 'remaining', width: 110, min: 90 },
  { key: 'progress',  flex: 1,    min: 160 },
  { key: 'actions',   width: 90,  min: 80, resizable: false },
];

export default function EnvelopesClient({ monthYear, progress, tags, categories, availableMonths, readyToAssign }: {
  monthYear: string;
  progress: EnvelopeProgress[];
  tags: TagRef[];
  categories: CatRef[];
  availableMonths: string[];
  readyToAssign: ReadyToAssign;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<'tag' | 'category'>('tag');
  const [name, setName] = useState('');
  const [allocated, setAllocated] = useState('200');
  const [tagId, setTagId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  // Save an edited allocation (inline "move money" interaction). PATCHes the
  // envelope and refreshes so Ready-to-Assign + totals recompute server-side.
  async function saveAllocation(id: string) {
    const v = parseFloat(editVal);
    setEditId(null);
    if (!Number.isFinite(v) || v < 0) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/envelopes/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocated: Math.round(v * 100) / 100 }),
      });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  async function autoAssign() {
    if (progress.length === 0) { setErr('Add envelopes first, then auto-assign.'); return; }
    if (!confirm(`Fund each envelope to its average spend over the last 3 months? This overwrites current allocations for ${monthYear}.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/envelopes/auto-assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthYear, apply: true, lookback: 3 }),
      });
      if (r.ok) router.refresh();
      else { const j = await r.json().catch(() => ({})); setErr(j.error ?? `Failed (${r.status})`); }
    } finally { setBusy(false); }
  }

  const rta = readyToAssign.readyToAssign;
  const rtaState: 'zero' | 'left' | 'over' = Math.abs(rta) < 0.005 ? 'zero' : rta > 0 ? 'left' : 'over';
  const rtaColor = rtaState === 'zero' ? 'var(--success)' : rtaState === 'left' ? 'var(--link)' : 'var(--error)';
  const rtaMsg = rtaState === 'zero'
    ? 'Every dollar has a job — your budget is fully assigned.'
    : rtaState === 'left'
      ? `${fmt(rta)} of your cash isn't assigned to an envelope yet.`
      : `You've assigned ${fmt(Math.abs(rta))} more than you hold in spendable cash.`;

  const totalAllocated = progress.reduce((s, p) => s + p.allocated, 0);
  const totalSpent     = progress.reduce((s, p) => s + p.spent, 0);
  const totalRemaining = totalAllocated - totalSpent;

  async function add() {
    const m = parseFloat(allocated);
    if (!name.trim() || !Number.isFinite(m) || m <= 0) { setErr('Name and allocation > 0'); return; }
    if (scope === 'tag' && !tagId) { setErr('Pick a tag'); return; }
    if (scope === 'category' && !categoryId) { setErr('Pick a category'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/envelopes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthYear, name: name.trim(), allocated: m, scope,
          tagId: scope === 'tag' ? tagId : null,
          categoryId: scope === 'category' ? categoryId : null,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `Failed (${r.status})`); return; }
      setName(''); setAllocated('200'); setTagId(''); setCategoryId('');
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/envelopes/${id}`, { method: 'DELETE' });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  async function copyFromLast() {
    const candidates = availableMonths.filter(m => m !== monthYear);
    const from = candidates[0];
    if (!from) { setErr('No prior month to copy from.'); return; }
    if (!confirm(`Duplicate every envelope from ${from} → ${monthYear}?`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/envelopes/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMonth: from, toMonth: monthYear }),
      });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  function prevMonth(my: string): string {
    const [y, m] = my.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function nextMonth(my: string): string {
    const [y, m] = my.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card padding={0} eyebrow="Zero-based budgeting" title="Ready to assign"
            action={<Btn variant="outline" size="sm" onClick={autoAssign} disabled={busy || progress.length === 0}>⚡ Auto-assign typical spend</Btn>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center', padding: '18px 22px', borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, color: rtaColor, lineHeight: 1 }}>
              {rta < 0 ? '−' : ''}{fmt(Math.abs(rta))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 8, maxWidth: 360, lineHeight: 1.5 }}>{rtaMsg}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 22, justifyContent: 'end', textAlign: 'right' }}>
            <MiniStat label={`Spendable cash · ${readyToAssign.liquidAccounts} acct${readyToAssign.liquidAccounts === 1 ? '' : 's'}`} value={fmt(readyToAssign.liquid)} />
            <MiniStat label="−  Assigned" value={fmt(readyToAssign.assigned)} />
            <MiniStat label="=  Ready" value={`${rta < 0 ? '−' : ''}${fmt(Math.abs(rta))}`} color={rtaColor} />
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
        <Card padding={20}><Stat label="Allocated" value={fmt(totalAllocated)} /></Card>
        <Card padding={20}><Stat label="Spent" value={fmt(totalSpent)} color="var(--accent)" /></Card>
        <Card padding={20}>
          <Stat label="Remaining" value={fmt(Math.abs(totalRemaining))}
                color={totalRemaining >= 0 ? 'var(--success)' : 'var(--error)'} sign={totalRemaining >= 0 ? '' : '−'} />
        </Card>
        <Card padding={20}><Stat label="Envelopes" value={String(progress.length)} /></Card>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href={`/envelopes?month=${prevMonth(monthYear)}`}><Btn variant="outline" size="sm">← {prevMonth(monthYear)}</Btn></Link>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)' }}>{monthYear}</span>
        <Link href={`/envelopes?month=${nextMonth(monthYear)}`}><Btn variant="outline" size="sm">{nextMonth(monthYear)} →</Btn></Link>
        <div style={{ flex: 1 }} />
        <Btn variant="outline" size="sm" onClick={copyFromLast} disabled={busy || availableMonths.length === 0}>
          ↳ Copy from last month
        </Btn>
      </div>

      <Card padding={0} eyebrow="This month" title="Allocations">
        <ResizableTableShell storageKey="astroledger-cols-envelopes" columns={ENV_COLS} gap={12}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'var(--cols)',
            padding: '10px 22px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)', gap: 12,
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}>
            <span>Name</span><span>Scope</span>
            <span style={{ textAlign: 'right' }}>Allocated</span>
            <span style={{ textAlign: 'right' }}>Spent</span>
            <span style={{ textAlign: 'right' }}>Remaining</span>
            <span>Progress</span><span />
          </div>
          {progress.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              No envelopes yet for {monthYear}.
            </div>
          ) : progress.map(p => (
            <div key={p.id} style={{
              display: 'grid', gridTemplateColumns: 'var(--cols)',
              padding: '14px 22px', borderBottom: '1px solid var(--border)',
              gap: 12, alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                <Pill tone={p.scope === 'tag' ? 'info' : 'default'}>{p.scope}</Pill>
                {p.rollover && <Pill tone="ghost" style={{ marginLeft: 6 }}>roll</Pill>}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg)' }}>
                {editId === p.id ? (
                  <input
                    type="number" min="0" step="0.01" autoFocus value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => saveAllocation(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveAllocation(p.id); if (e.key === 'Escape') setEditId(null); }}
                    style={{ width: 90, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13,
                             padding: '4px 6px', border: '1px solid var(--accent)', borderRadius: 'var(--r-xs)',
                             background: 'var(--bg-panel)', color: 'var(--fg-strong)' }} />
                ) : (
                  <button
                    onClick={() => { setEditId(p.id); setEditVal(String(p.allocated)); }}
                    title="Click to reassign — moves money to/from Ready to Assign"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)',
                             fontSize: 13, color: 'var(--fg)', padding: 0, borderBottom: '1px dashed var(--border)' }}>
                    {fmt(p.allocated)}
                  </button>
                )}
                {p.rollover && p.rolledIn !== 0 && (
                  <div style={{ fontSize: 10, color: p.rolledIn > 0 ? 'var(--success)' : 'var(--error)' }}>
                    {p.rolledIn > 0 ? '+' : '−'}{fmt(Math.abs(p.rolledIn))} rolled
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13,
                color: p.state === 'over' ? 'var(--error)' : 'var(--fg-strong)' }}>{fmt(p.spent)}</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13,
                color: p.remaining < 0 ? 'var(--error)' : 'var(--success)' }}>
                {p.remaining < 0 ? '−' : ''}{fmt(Math.abs(p.remaining))}
              </div>
              <div>
                <ProgressBar value={p.spent} max={p.allocated + Math.max(0, p.rolledIn)} height={6} warn={0.85} danger={1} />
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', marginTop: 3 }}>
                  {(p.pct * 100).toFixed(0)}%
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <ChipBtn tone="danger" onClick={() => remove(p.id)} disabled={busy}>✕</ChipBtn>
              </div>
            </div>
          ))}
        </ResizableTableShell>
      </Card>

      <Card eyebrow="New envelope" title="Allocate dollars">
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1.4fr 1.4fr 100px auto', gap: 10, alignItems: 'center' }}>
          <select value={scope} onChange={e => setScope(e.target.value as any)} style={inp}>
            <option value="tag">Tag</option>
            <option value="category">Category</option>
          </select>
          <input placeholder="Envelope name (e.g. Groceries)" value={name} onChange={e => setName(e.target.value)} style={inp} />
          {scope === 'tag' ? (
            <select value={tagId} onChange={e => setTagId(e.target.value)} style={inp}>
              <option value="">Pick tag…</option>
              {tags.map(t => <option key={t.id} value={t.id}>{t.parentName ? `${t.parentName} › ${t.name}` : t.name}</option>)}
            </select>
          ) : (
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={inp}>
              <option value="">Pick category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input type="number" min="0" step="0.01" value={allocated} onChange={e => setAllocated(e.target.value)} style={inp} placeholder="amount $" />
          <Btn variant="primary" onClick={add} disabled={busy}>+ Add</Btn>
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--error)', marginTop: 8 }}>{err}</div>}
      </Card>
    </div>
  );
}

function Stat({ label, value, color, sign }: { label: string; value: string; color?: string; sign?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat-sub" style={{ marginTop: 8, color: color ?? undefined }}>{sign ?? ''}{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)', fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: color ?? 'var(--fg-strong)' }}>{value}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
