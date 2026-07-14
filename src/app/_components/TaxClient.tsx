'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Btn, Pill, ChipBtn } from './atoms';
import { ResizableTableShell } from './useResizableColumns';

type Matcher = { kind: 'tag' | 'category'; value: string };
type Bucket = {
  id: string;
  scheduleLine: string;
  name: string;
  matchers: Matcher[];
  notes: string | null;
  sortOrder: number;
};
type TagRef = { id: string; name: string; parentName: string | null };
type CatRef = { id: string; name: string };

const TAX_COLS = [
  { key: 'line',     width: 110, min: 90 },
  { key: 'name',     width: 220, min: 160 },
  { key: 'matchers', flex: 1,    min: 240 },
  { key: 'actions',  width: 90,  min: 80, resizable: false },
];

export default function TaxClient({ buckets, tags, categories }: {
  buckets: Bucket[]; tags: TagRef[]; categories: CatRef[];
}) {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function exportCsv() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/tax/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, format: 'csv' }),
      });
      if (!r.ok) { setErr(`Export failed (${r.status})`); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `astroledger-tax-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  }

  async function preview() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/tax/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, format: 'json' }),
      });
      if (!r.ok) { setErr(`Preview failed (${r.status})`); return; }
      const j = await r.json();
      const lines = Object.entries(j.totalsByBucket)
        .sort(([, a]: any, [, b]: any) => b - a)
        .map(([k, v]: any) => `${k}: $${Number(v).toFixed(2)}`)
        .join('\n');
      alert(`Year ${year} - ${j.rows.length} txs, total $${j.grandTotal.toFixed(2)}\n\n${lines}`);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card eyebrow="Export" title={`Tax year ${year}`}
            action={<Pill tone="info">Schedule C</Pill>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Year{' '}
            <input type="number" value={year} onChange={e => setYear(+e.target.value)} style={inp} />
          </label>
          <Btn variant="outline" onClick={preview} disabled={busy}>Preview totals</Btn>
          <Btn variant="primary" onClick={exportCsv} disabled={busy}>↓ Export CSV</Btn>
          {err && <span style={{ fontSize: 12, color: 'var(--error)' }}>{err}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 10, lineHeight: 1.5 }}>
          Includes all <strong>outflow, non-transfer</strong> transactions in the calendar year.
          Split parents are excluded (children flow through). Each transaction lands in the first
          bucket whose tag/category matcher hits; unmatched rows go to <strong>Unbucketed</strong>.
        </div>
      </Card>

      <Card padding={0} eyebrow="Buckets" title="Schedule C mapping">
        <ResizableTableShell storageKey="astroledger-cols-tax-buckets" columns={TAX_COLS} gap={12}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'var(--cols)',
            padding: '10px 22px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)', gap: 12,
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}>
            <span>Line</span><span>Name</span><span>Matchers</span><span />
          </div>
          {buckets.map(b => (
            <BucketRow key={b.id} b={b} tags={tags} categories={categories} onRefresh={() => router.refresh()} />
          ))}
        </ResizableTableShell>
      </Card>
    </div>
  );
}

function BucketRow({ b, tags, categories, onRefresh }: {
  b: Bucket; tags: TagRef[]; categories: CatRef[]; onRefresh: () => void;
}) {
  const [matchers, setMatchers] = useState<Matcher[]>(b.matchers);
  const [newKind, setNewKind] = useState<'tag' | 'category'>('tag');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(next: Matcher[]) {
    setBusy(true);
    try {
      const r = await fetch(`/api/tax/buckets/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchers: next }),
      });
      if (r.ok) onRefresh();
    } finally { setBusy(false); }
  }

  function addMatcher() {
    if (!newValue) return;
    const next = [...matchers, { kind: newKind, value: newValue }];
    setMatchers(next);
    setNewValue('');
    save(next);
  }
  function removeMatcher(i: number) {
    const next = matchers.filter((_, idx) => idx !== i);
    setMatchers(next);
    save(next);
  }

  async function remove() {
    if (!confirm(`Delete bucket "${b.scheduleLine} - ${b.name}"?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/tax/buckets/${b.id}`, { method: 'DELETE' });
      if (r.ok) onRefresh();
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'var(--cols)',
      padding: '12px 22px', borderBottom: '1px solid var(--border)',
      gap: 12, alignItems: 'start',
    }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{b.scheduleLine}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
        {b.name}
        {b.notes && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, fontWeight: 400 }}>{b.notes}</div>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {matchers.map((m, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 'var(--r-pill)',
            border: '1px solid var(--border)', background: 'var(--bg-elevated)',
            fontSize: 11, color: 'var(--fg)',
          }}>
            <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>{m.kind === 'tag' ? '◇' : '☐'}</span>
            {m.value}
            <button onClick={() => removeMatcher(i)} disabled={busy}
                    style={{ background: 'none', border: 0, color: 'var(--fg-subtle)', cursor: 'pointer', padding: 0, marginLeft: 2 }}>×</button>
          </span>
        ))}
        <select value={newKind} onChange={e => setNewKind(e.target.value as any)} style={{ ...inp, height: 28, fontSize: 11 }}>
          <option value="tag">tag</option>
          <option value="category">category</option>
        </select>
        <select value={newValue} onChange={e => setNewValue(e.target.value)} style={{ ...inp, height: 28, fontSize: 11, maxWidth: 220 }}>
          <option value="">{newKind === 'tag' ? 'Pick tag…' : 'Pick category…'}</option>
          {newKind === 'tag'
            ? tags.map(t => <option key={t.id} value={t.name}>{t.parentName ? `${t.parentName} › ${t.name}` : t.name}</option>)
            : categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <ChipBtn tone="accent" onClick={addMatcher} disabled={busy || !newValue}>+ Match</ChipBtn>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ChipBtn tone="danger" onClick={remove} disabled={busy}>✕</ChipBtn>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
