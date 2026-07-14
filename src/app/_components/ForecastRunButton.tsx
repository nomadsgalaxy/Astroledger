'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function ForecastRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/forecast/run', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) { setMsg(`Error: ${j.error}`); setBusy(false); return; }
    setMsg(`Generated ${j.categories} category forecasts (${j.points} points).`);
    setBusy(false);
    router.refresh();
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Btn variant="primary" onClick={run} disabled={busy}>{busy ? 'Forecasting…' : 'Generate forecast'}</Btn>
      {msg && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{msg}</span>}
    </div>
  );
}
