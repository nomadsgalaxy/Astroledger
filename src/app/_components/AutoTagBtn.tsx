'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DropdownPortal from './DropdownPortal';

type Result = {
  considered: number;
  tagged: number;
  totalAttachments: number;
  llmUsed: boolean;
  byTag: Record<string, number>;
  errors: string[];
  propagated?: { subscriptions: number; transactions: number; attachments: number };
};

export default function AutoTagBtn() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const caretRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const run = async (mode: 'untagged' | 'all') => {
    setRunning(true);
    setOpen(false);
    setResult(null);
    try {
      const res = await fetch('/api/transactions/auto-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, scope: 'range' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-tag failed');
      setResult(data);
      startTransition(() => router.refresh());
      setTimeout(() => setResult(null), 10_000);
    } catch (err) {
      alert('Auto-tag failed: ' + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex' }}>
        <button onClick={() => run('untagged')} disabled={running} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 36, padding: '0 14px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
          background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1,
        }}>
          <span style={{ color: 'var(--prusa-pro-green)' }}>◈</span>
          {running ? 'Tagging…' : 'Auto-tag'}
        </button>
        <button ref={caretRef} onClick={() => setOpen(o => !o)} disabled={running} style={{
          height: 36, padding: '0 8px',
          border: '1px solid var(--border)', borderLeft: 0,
          borderRadius: '0 var(--r-sm) var(--r-sm) 0',
          background: 'var(--bg-elevated)', color: 'var(--fg-muted)',
          fontSize: 10, cursor: 'pointer',
        }} title="More options">▾</button>
      </div>
      <DropdownPortal triggerRef={caretRef} open={open} onClose={() => setOpen(false)} width={260} align="end" maxHeight={200}>
        <DropItem label="Only untagged" hint="Skip transactions that already have tags" onClick={() => run('untagged')} />
        <DropItem label="Re-tag all" hint="Add tags to every transaction in the window (existing tags kept)" onClick={() => run('all')} />
      </DropdownPortal>
      <DropdownPortal triggerRef={containerRef} open={!!result} onClose={() => setResult(null)} width={340} align="end" maxHeight={420}>
        {result && (
          <div style={{ padding: 8, fontSize: 12 }}>
            <div style={{
              fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)',
              textTransform: 'uppercase', fontSize: 10, color: 'var(--prusa-pro-green)', marginBottom: 8,
            }}>
              {result.llmUsed ? 'LLM' : 'Skipped'} · {result.tagged} txs tagged · {result.totalAttachments} attachments
            </div>
            <div style={{ color: 'var(--fg-muted)', marginBottom: result.errors.length ? 6 : 0 }}>
              Considered {result.considered} transactions.
            </div>
            {result.propagated && result.propagated.transactions > 0 && (
              <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--accent)' }}>
                Propagated from {result.propagated.subscriptions} subscription{result.propagated.subscriptions === 1 ? '' : 's'} → {result.propagated.transactions} tx{result.propagated.transactions === 1 ? '' : 's'}
              </div>
            )}
            {Object.entries(result.byTag).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, n]) => (
              <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: 'var(--fg)' }}>
                <span>{tag}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{n}</span>
              </div>
            ))}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--error)' }}>
                {result.errors.slice(0, 2).map((e, i) => <div key={i}>{e}</div>)}
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
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{hint}</div>
    </button>
  );
}
