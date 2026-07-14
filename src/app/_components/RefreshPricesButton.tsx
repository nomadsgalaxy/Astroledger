'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function RefreshPricesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/holdings/refresh-prices', { method: 'POST' });
      const j = await r.json();
      if (!j.configured) { setMsg(j.note ?? 'No price provider configured.'); return; }
      const bits = [`${j.updated} updated`];
      if (j.skipped) bits.push(`${j.skipped} skipped (no ticker)`);
      if (j.failed) bits.push(`${j.failed} no quote`);
      if (j.rateLimited) bits.push('rate-limited — run again shortly');
      setMsg(`${bits.join(' · ')} (via ${j.provider})`);
      router.refresh();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      {msg && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{msg}</span>}
      <Btn variant="outline" size="sm" icon="↻" disabled={busy} onClick={refresh}>{busy ? 'Refreshing…' : 'Refresh prices'}</Btn>
    </div>
  );
}
