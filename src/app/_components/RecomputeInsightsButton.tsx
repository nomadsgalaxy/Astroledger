'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function RecomputeInsightsButton() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/recompute', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Refresh failed');
      const count = Number(result.recommendations ?? 0);
      setMessage(`${count} recommendation${count === 1 ? '' : 's'}`);
      startTransition(() => router.refresh());
      setTimeout(() => setMessage(null), 6000);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      {message && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{message}</span>}
      <Btn variant="outline" size="md" icon="↻" onClick={run} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh insights'}
      </Btn>
    </div>
  );
}
