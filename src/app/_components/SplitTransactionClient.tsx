'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, fmt } from './atoms';
import type { TagOption } from './TagPicker';

type Parent = {
  id: string;
  amount: number;
  merchant: string | null;
  rawDescription: string;
  currentCategory: string | null;
  isSplit: boolean;
};

type SplitRow = {
  amount: string;          // string so user can type "12.50" without immediate Number parse
  categoryName: string;
  tagIds: Set<string>;
  notes: string;
};

export default function SplitTransactionClient({ parent, existingSplits, categories, tags }: {
  parent: Parent;
  existingSplits: Array<{ id: string; amount: number; merchant: string | null; categoryName: string | null; tagNames: string[]; notes: string | null }>;
  categories: Array<{ name: string; color: string | null }>;
  tags: TagOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SplitRow[]>(() =>
    parent.isSplit && existingSplits.length > 0
      ? existingSplits.map(s => ({
          amount: s.amount.toFixed(2),
          categoryName: s.categoryName ?? '',
          tagIds: new Set(tags.filter(t => s.tagNames.includes(t.name)).map(t => t.id)),
          notes: s.notes ?? '',
        }))
      : [
          { amount: (parent.amount / 2).toFixed(2), categoryName: parent.currentCategory ?? '', tagIds: new Set(), notes: '' },
          { amount: (parent.amount / 2).toFixed(2), categoryName: '', tagIds: new Set(), notes: '' },
        ],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sum = useMemo(() => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [rows]);
  const remaining = parent.amount - sum;
  const balanced = Math.abs(remaining) < 0.005;

  function update(i: number, patch: Partial<SplitRow>) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function remove(i: number) { setRows(rs => rs.filter((_, idx) => idx !== i)); }
  function add() { setRows(rs => [...rs, { amount: remaining.toFixed(2), categoryName: '', tagIds: new Set(), notes: '' }]); }

  async function save() {
    if (!balanced) { setErr(`Splits must sum to ${parent.amount.toFixed(2)} (currently ${sum.toFixed(2)})`); return; }
    setBusy(true); setErr(null);
    try {
      // If parent was already split, undo first so we can replace cleanly
      if (parent.isSplit) {
        await fetch(`/api/transactions/${parent.id}/split`, { method: 'DELETE' });
      }
      const r = await fetch(`/api/transactions/${parent.id}/split`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: rows.map(row => ({
            amount: parseFloat(row.amount),
            categoryName: row.categoryName || undefined,
            tagIds: Array.from(row.tagIds),
            notes: row.notes || undefined,
          })),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error || 'Save failed');
        setBusy(false);
        return;
      }
      router.push('/transactions');
      router.refresh();
    } finally { setBusy(false); }
  }

  async function unsplit() {
    if (!confirm('Remove all splits and restore this transaction as a single row?')) return;
    setBusy(true);
    try {
      await fetch(`/api/transactions/${parent.id}/split`, { method: 'DELETE' });
      router.push('/transactions');
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase' }}>Parent</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16 }}>
          {parent.amount > 0 ? '+' : '−'}{fmt(Math.abs(parent.amount))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Splits sum to {sum.toFixed(2)} · remaining {remaining.toFixed(2)}</div>
        <Pill tone={balanced ? 'success' : 'warning'}>{balanced ? 'Balanced' : `Off by ${Math.abs(remaining).toFixed(2)}`}</Pill>
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 10, alignItems: 'center' }}>
            <input type="number" step="0.01" value={row.amount} onChange={e => update(i, { amount: e.target.value })}
                   placeholder="0.00" style={inputCss} />
            <input list={`cats-${i}`} value={row.categoryName} onChange={e => update(i, { categoryName: e.target.value })}
                   placeholder="Category" style={inputCss} />
            <datalist id={`cats-${i}`}>
              {categories.map(c => <option key={c.name} value={c.name} />)}
            </datalist>
            <button onClick={() => remove(i)} disabled={busy || rows.length <= 2}
                    style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: rows.length <= 2 ? 'not-allowed' : 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map(t => {
              const active = row.tagIds.has(t.id);
              return (
                <button key={t.id} onClick={() => {
                  update(i, { tagIds: new Set(active ? Array.from(row.tagIds).filter(x => x !== t.id) : [...row.tagIds, t.id]) });
                }} style={{
                  padding: '3px 8px', borderRadius: 'var(--r-pill)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'rgba(253,80,0,0.1)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--fg-muted)',
                  fontSize: 10, cursor: 'pointer',
                }}>
                  {t.parentName ? `${t.parentName}/${t.name}` : t.name}
                </button>
              );
            })}
          </div>
          <input value={row.notes} onChange={e => update(i, { notes: e.target.value })}
                 placeholder="Notes (optional)" style={inputCss} />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="outline" onClick={add} disabled={busy}>+ Add another split</Btn>
        {parent.isSplit && <Btn variant="ghost" onClick={unsplit} disabled={busy}>Remove all splits</Btn>}
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={save} disabled={busy || !balanced}>{busy ? 'Saving…' : 'Save splits'}</Btn>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
    </div>
  );
}

const inputCss: React.CSSProperties = {
  height: 32, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
  background: 'var(--bg)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
};
