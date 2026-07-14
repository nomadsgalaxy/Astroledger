'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Result = {
  tags?: { merged: number; kept: number; moves: number };
  subscriptions?: { merged: number; kept: number; txReassigned: number };
  transactions?: { flagged: number };
  error?: string;
};

export default function DedupePanel() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (scope: 'all' | 'tags' | 'subscriptions' | 'transactions') => {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch('/api/dedupe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Dedupe failed');
      setResult(data);
      startTransition(() => router.refresh());
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Tags</strong> - merges root tags with the same name (case-insensitive). The older row wins; children, transactions, and subscriptions move over.</li>
          <li><strong>Subscriptions</strong> - merges near-duplicates for the same merchant (cadence within ±4 days, amount within 15%). Transactions get re-pointed and tags are unioned onto the surviving subscription.</li>
          <li><strong>Transactions</strong> - flags cross-account duplicates (same merchant + day + amount) as transfers so rollups stop double-counting. The bank-side charge is preserved; the wallet/ecommerce side is hidden from totals.</li>
        </ul>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={() => run('all')} disabled={running} primary>{running ? 'Running…' : 'Run all'}</Btn>
        <Btn onClick={() => run('tags')} disabled={running}>Tags only</Btn>
        <Btn onClick={() => run('subscriptions')} disabled={running}>Subscriptions only</Btn>
        <Btn onClick={() => run('transactions')} disabled={running}>Transactions only</Btn>
      </div>
      {result?.error && (
        <div style={{ fontSize: 12, color: 'var(--error)' }}>{result.error}</div>
      )}
      {result && !result.error && (
        <div style={{
          padding: 12, background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fg)', lineHeight: 1.7,
        }}>
          {result.tags && (
            <div>tags: <strong style={{ color: 'var(--success)' }}>{result.tags.merged} merged</strong> · {result.tags.kept} kept · {result.tags.moves} attachments moved</div>
          )}
          {result.subscriptions && (
            <div>subs: <strong style={{ color: 'var(--success)' }}>{result.subscriptions.merged} merged</strong> · {result.subscriptions.kept} kept · {result.subscriptions.txReassigned} txs reassigned</div>
          )}
          {result.transactions && (
            <div>tx: <strong style={{ color: result.transactions.flagged > 0 ? 'var(--warning)' : 'var(--success)' }}>{result.transactions.flagged} flagged</strong> as cross-source duplicates</div>
          )}
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 14px', borderRadius: 'var(--r-sm)',
      border: '1px solid var(--border)',
      background: primary ? 'var(--accent)' : 'var(--bg-elevated)',
      color: primary ? '#fff' : 'var(--fg-strong)',
      fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
      letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
      cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}
