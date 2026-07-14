'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function QuickenUploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const r = await fetch('/api/quicken', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) { setMsg(`Error: ${j.error}`); setBusy(false); return; }
    let m = `Imported ${j.inserted} ${j.format.toUpperCase()} transactions (skipped ${j.skipped}).`;
    const inv = j.investments;
    if (inv) {
      m += ` Investments: ${inv.securitiesCreated} securities, ${Number(inv.pricesInserted).toLocaleString()} prices, ` +
           `${inv.investmentTxnsInserted} trades → ${inv.holdingsRebuilt} holdings` +
           (inv.pricesSkippedUnknownSec ? ` (${inv.pricesSkippedUnknownSec} prices skipped: unknown security)` : '') + '.';
    }
    setMsg(m);
    setBusy(false);
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Account name (used for QIF)</label>
        <input name="accountName" placeholder="My Bank Checking"
          style={{
            width: '100%', height: 36, padding: '0 12px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg)',
            fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
          }} />
      </div>
      <input type="file" name="file" accept=".ofx,.qfx,.qbo,.qif" required style={{ fontSize: 13, color: 'var(--fg-muted)' }} />
      <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Importing…' : 'Import .OFX / .QFX / .QBO / .QIF'}</Btn>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}
    </form>
  );
}
