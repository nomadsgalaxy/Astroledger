'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function ForecastActions({ hasForecasts }: { hasForecasts: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clearAll() {
    if (!confirm('Delete every forecast on this account? You can always regenerate.')) return;
    setBusy(true);
    const r = await fetch('/api/forecasts', { method: 'DELETE' });
    setBusy(false);
    if (r.ok) router.refresh();
  }

  if (!hasForecasts) return null;
  return (
    <Btn variant="ghost" size="sm" disabled={busy} onClick={clearAll} style={{ color: 'var(--error)' }}>
      {busy ? 'Clearing…' : 'Clear forecasts'}
    </Btn>
  );
}
