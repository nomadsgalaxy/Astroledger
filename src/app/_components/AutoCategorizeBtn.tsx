'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DropdownPortal from './DropdownPortal';

type Result = {
  considered: number;
  updated: number;
  llmUsed: boolean;
  byCategory: Record<string, number>;
  errors: string[];
};

export default function AutoCategorizeBtn() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const caretRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const run = async (mode: 'uncategorized' | 'all') => {
    setRunning(true);
    setOpen(false);
    setResult(null);
    try {
      const res = await fetch('/api/transactions/auto-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, scope: 'range' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Categorize failed');
      setResult(data);
      startTransition(() => router.refresh());
      setTimeout(() => setResult(null), 8000);
    } catch (err) {
      console.error('Auto-categorize failed', err);
      alert('Auto-categorize failed: ' + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 0 }}>
        <button
          onClick={() => run('uncategorized')}
          disabled={running}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 36, padding: '0 14px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1,
          }}
        >
          <span style={{ color: 'var(--accent)' }}>✨</span>
          {running ? 'Categorizing…' : 'Auto-categorize'}
        </button>
        <button
          ref={caretRef}
          onClick={() => setOpen(o => !o)}
          disabled={running}
          style={{
            height: 36, padding: '0 8px',
            border: '1px solid var(--border)', borderLeft: 0,
            borderRadius: '0 var(--r-sm) var(--r-sm) 0',
            background: 'var(--bg-elevated)', color: 'var(--fg-muted)',
            fontSize: 10, cursor: 'pointer',
          }}
          title="More options"
        >▾</button>
      </div>
      <DropdownPortal triggerRef={caretRef} open={open} onClose={() => setOpen(false)} width={240} align="end" maxHeight={200}>
        <DropItem label="Only uncategorized" hint="Skip transactions that already have a category" onClick={() => run('uncategorized')} />
        <DropItem label="Re-categorize all" hint="Overwrite every transaction in the window" onClick={() => run('all')} />
      </DropdownPortal>
      <DropdownPortal triggerRef={containerRef} open={!!result} onClose={() => setResult(null)} width={320} align="end" maxHeight={400}>
        {result && (
          <div style={{ padding: 8, fontSize: 12 }}>
            <div style={{ fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontSize: 10, color: 'var(--accent)', marginBottom: 8 }}>
              {result.llmUsed ? 'LLM' : 'Rules'} · {result.updated} updated
            </div>
            <div style={{ color: 'var(--fg-muted)', marginBottom: result.errors.length ? 6 : 0 }}>
              Considered {result.considered} transactions.
            </div>
            {Object.entries(result.byCategory).slice(0, 6).map(([cat, n]) => (
              <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: 'var(--fg)' }}>
                <span>{cat}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{n}</span>
              </div>
            ))}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--error)' }}>
                {result.errors.length} batch error{result.errors.length === 1 ? '' : 's'} - fell back to rules
              </div>
            )}
          </div>
        )}
      </DropdownPortal>
    </div>
  );
}

function DropItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '8px 10px', borderRadius: 'var(--r-xs)', border: 'none',
      background: 'transparent', cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{hint}</div>
    </button>
  );
}
