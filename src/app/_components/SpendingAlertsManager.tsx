'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, ChipBtn, ProgressBar, fmt } from './atoms';
import type { AlertProgress } from '@/lib/spendingAlerts';

type TagRef = { id: string; name: string; parentName: string | null };
type CatRef = { id: string; name: string };

export default function SpendingAlertsManager({ progress, tags, categories }: {
  progress: AlertProgress[];
  tags: TagRef[];
  categories: CatRef[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<'tag' | 'category' | 'overall'>('tag');
  const [tagId, setTagId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [cap, setCap] = useState('200');
  const [warnPct, setWarnPct] = useState('80');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const m = parseFloat(cap);
    const w = parseFloat(warnPct) / 100;
    if (!Number.isFinite(m) || m <= 0) { setErr('Cap must be > 0'); return; }
    if (scope === 'tag' && !tagId) { setErr('Pick a tag'); return; }
    if (scope === 'category' && !categoryId) { setErr('Pick a category'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/spending-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          tagId: scope === 'tag' ? tagId : null,
          categoryId: scope === 'category' ? categoryId : null,
          monthlyCap: m,
          warnPct: w,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `Failed (${r.status})`); return; }
      setTagId(''); setCategoryId(''); setCap('200');
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/spending-alerts/${id}`, { method: 'DELETE' });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/spending-alerts/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        Set a monthly cap on a tag, category, or overall spending. Astroledger surfaces a status pill
        (green / amber / red) as you approach and cross the limit.
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {progress.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '12px 0' }}>No alerts configured yet.</div>
        )}
        {progress.map(p => (
          <div key={p.id} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            padding: 12, background: 'var(--bg-elevated)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Pill tone={p.scope === 'tag' ? 'info' : p.scope === 'category' ? 'default' : 'pro'}>
                {p.scope}
              </Pill>
              <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{p.label}</strong>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                {fmt(p.spentThisMonth)} / {fmt(p.monthlyCap)}
              </span>
              <Pill tone={p.state === 'over' ? 'error' : p.state === 'warn' ? 'warning' : 'success'}>
                {(p.pct * 100).toFixed(0)}%
              </Pill>
              <div style={{ flex: 1 }} />
              <ChipBtn onClick={() => toggle(p.id, !p.enabled)} disabled={busy}>
                {p.enabled ? '⏸ Pause' : '▶ Enable'}
              </ChipBtn>
              <ChipBtn tone="danger" onClick={() => remove(p.id)} disabled={busy}>✕</ChipBtn>
            </div>
            <ProgressBar value={p.spentThisMonth} max={p.monthlyCap} height={6}
              warn={p.warnPct} danger={1} />
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 8, padding: 12,
        border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)',
        display: 'grid', gridTemplateColumns: '120px 1fr 120px 100px auto', gap: 10, alignItems: 'center',
      }}>
        <select value={scope} onChange={e => setScope(e.target.value as any)} style={inp}>
          <option value="tag">Tag</option>
          <option value="category">Category</option>
          <option value="overall">Overall</option>
        </select>
        {scope === 'tag' && (
          <select value={tagId} onChange={e => setTagId(e.target.value)} style={inp}>
            <option value="">Pick tag…</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.parentName ? `${t.parentName} › ${t.name}` : t.name}</option>)}
          </select>
        )}
        {scope === 'category' && (
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={inp}>
            <option value="">Pick category…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {scope === 'overall' && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>All outflow this month</div>}
        <input type="number" min="0" step="0.01" value={cap} onChange={e => setCap(e.target.value)} style={inp} placeholder="monthly $" />
        <input type="number" min="0" max="100" value={warnPct} onChange={e => setWarnPct(e.target.value)} style={inp} title="Warn at % of cap" />
        <Btn variant="primary" size="sm" onClick={add} disabled={busy}>+ Alert</Btn>
      </div>
      {err && <span style={{ fontSize: 12, color: 'var(--error)' }}>{err}</span>}
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
