'use client';
import { useState, useRef, useEffect, useMemo } from 'react';

export type AccountOption = {
  id: string;
  name: string;             // e.g. "Spend (1011)" - the user-visible account name (leads here)
  mask: string | null;      // optional last-4
  institution: string;      // e.g. "My Banks" / "SimpleFIN (beta-bridge...)" - secondary
};

// Search-as-you-type account combobox. Filters by account name, mask, and
// institution (case-insensitive substring). Keyboard nav: ↑/↓ to move, Enter
// to select, Esc to close. Click outside to dismiss.
export default function AccountPicker({ value, onChange, options }: {
  value: string;
  onChange: (id: string) => void;
  options: AccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find(o => o.id === value) ?? null, [options, value]);

  // Filter - substring match across name + mask + institution. Score so exact
  // mask matches surface first, then name-prefix matches, then everything else.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options
      .map(o => {
        const name = o.name.toLowerCase();
        const inst = o.institution.toLowerCase();
        const mask = (o.mask ?? '').toLowerCase();
        let score = 0;
        if (mask && mask === q) score = 100;
        else if (mask && mask.includes(q)) score = 80;
        else if (name.startsWith(q)) score = 60;
        else if (name.includes(q)) score = 40;
        else if (inst.includes(q)) score = 20;
        return { o, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.o);
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset cursor when results change
  useEffect(() => { setCursor(0); }, [query, open]);

  function pick(o: AccountOption) {
    onChange(o.id);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setCursor(c => Math.min(filtered.length - 1, c + 1)); e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setCursor(c => Math.max(0, c - 1)); e.preventDefault();
    } else if (e.key === 'Enter') {
      const o = filtered[cursor];
      if (o) { pick(o); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false); setQuery(''); e.preventDefault();
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        style={{
          width: '100%', minHeight: 36, padding: '6px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          background: 'var(--bg-elevated)', color: 'var(--fg)',
          display: 'flex', alignItems: 'center', cursor: 'text',
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={selected ? selected.name : 'Search accounts by name, mask, or institution…'}
            style={{
              flex: 1, border: 0, outline: 0, background: 'transparent',
              color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 13,
            }}
            autoFocus
          />
        ) : selected ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flex: 1 }}>
            <span style={{ fontWeight: 600, color: 'var(--fg-strong)' }}>{selected.name}</span>
            {selected.mask && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>· {selected.mask}</span>
            )}
            {selected.institution && (
              <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>· {selected.institution}</span>
            )}
          </span>
        ) : (
          <span style={{ flex: 1, color: 'var(--fg-subtle)', fontSize: 13 }}>Pick an account…</span>
        )}
        <span style={{ color: 'var(--fg-subtle)', fontSize: 10, marginLeft: 8 }}>{open ? '▴' : '▾'}</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-lg)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
              No accounts match "{query}".
            </div>
          ) : filtered.map((o, i) => {
            const active = i === cursor;
            const isSelected = o.id === value;
            return (
              <div
                key={o.id}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={e => { e.preventDefault(); pick(o); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: active ? 'var(--bg-subtle)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{o.name}</span>
                  {o.mask && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>· {o.mask}</span>
                  )}
                </div>
                {o.institution && (
                  <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>{o.institution}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
