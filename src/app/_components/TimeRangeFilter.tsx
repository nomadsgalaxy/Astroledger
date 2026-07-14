'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RANGE_OPTIONS, type RangeKey } from '@/lib/timeRange';
import DropdownPortal from './DropdownPortal';

export default function TimeRangeFilter({ value }: { value: RangeKey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const current = RANGE_OPTIONS.find(o => o.key === value) ?? RANGE_OPTIONS[1];

  const pick = async (key: RangeKey) => {
    setOpen(false);
    await fetch('/api/range', { method: 'POST', body: JSON.stringify({ key }), headers: { 'Content-Type': 'application/json' } });
    startTransition(() => router.refresh());
  };

  return (
    <div style={{ position: 'relative' }} title="Global time range">
      <button ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
          fontFamily: 'var(--font-product)', fontWeight: 600, fontSize: 11,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        <span style={{ color: 'var(--fg-muted)', fontSize: 9 }}>Range</span>
        <span>{current.shortLabel}</span>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 9 }}>▾</span>
      </button>
      <DropdownPortal triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} width={180} align="end" maxHeight={280}>
        {RANGE_OPTIONS.map(opt => {
          const active = opt.key === value;
          return (
            <button key={opt.key}
              onClick={() => pick(opt.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                padding: '8px 12px', borderRadius: 'var(--r-xs)', border: 'none',
                background: active ? 'var(--bg-subtle)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--fg)',
                fontFamily: 'var(--font-body)', fontWeight: active ? 600 : 400, fontSize: 13,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span>{opt.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-subtle)' }}>{opt.shortLabel}</span>
            </button>
          );
        })}
      </DropdownPortal>
    </div>
  );
}
