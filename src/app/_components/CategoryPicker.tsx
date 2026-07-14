'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DropdownPortal from './DropdownPortal';

export default function CategoryPicker({
  txId, current, currentColor, categories, onChanged,
}: {
  txId: string; current: string; currentColor: string | null;
  categories: Array<{ name: string; color: string | null }>;
  onChanged?: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(current);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const colorFor = (name: string) => categories.find(c => c.name === name)?.color || 'var(--gray-500)';
  const displayColor = colorFor(value) || currentColor || 'var(--gray-500)';

  const pick = async (name: string) => {
    if (name === value) { setOpen(false); return; }
    setValue(name);
    setOpen(false);
    setSaving(true);
    try {
      const res = await fetch('/api/transactions/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId, category: name }),
      });
      if (!res.ok) {
        setValue(current); // rollback
        throw new Error(await res.text());
      }
      onChanged?.(name);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('Failed to set category', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
      <button ref={triggerRef} onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', border: '1px solid transparent', borderRadius: 'var(--r-xs)',
        background: 'transparent', cursor: 'pointer',
        color: 'var(--fg)', fontSize: 12, fontFamily: 'var(--font-body)',
        opacity: saving ? 0.5 : 1,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-subtle)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
      >
        <i style={{ width: 8, height: 8, borderRadius: 2, background: displayColor }} />
        <span>{value}</span>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 9 }}>▾</span>
      </button>
      <DropdownPortal triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} width={200} maxHeight={320}>
        {categories.map(c => {
          const active = c.name === value;
          return (
            <button key={c.name} onClick={() => pick(c.name)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '6px 10px', borderRadius: 'var(--r-xs)', border: 'none',
              background: active ? 'var(--bg-subtle)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--fg)',
              fontFamily: 'var(--font-body)', fontWeight: active ? 600 : 400, fontSize: 13,
              cursor: 'pointer', textAlign: 'left',
            }}>
              <i style={{ width: 8, height: 8, borderRadius: 2, background: c.color || 'var(--gray-500)' }} />
              {c.name}
            </button>
          );
        })}
      </DropdownPortal>
    </div>
  );
}
