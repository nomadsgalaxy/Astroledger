'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill } from './atoms';

export default function GmailSyncButton({ lastSync, gmailConnected }: { lastSync: string | null; gmailConnected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState(90);

  async function go() {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/orders/gmail/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sinceDays, max: 300 }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(`Error: ${j.error}`); setBusy(false); return; }
    setMsg(`Scanned ${j.scanned} emails, imported ${j.imported} new receipts, matched ${j.matched} to charges.`);
    setBusy(false);
    router.refresh();
  }

  if (!gmailConnected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Pill tone="ghost">Not connected</Pill>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Receipt scanning is off until you authorize Gmail read access.
          </span>
        </div>
        <a href="/api/gmail/authorize" style={{ textDecoration: 'none' }}>
          <Btn variant="primary">Connect Gmail receipts</Btn>
        </a>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
          Re-authorizes your Google account with the additional <code>gmail.readonly</code> scope. Astroledger only reads - 
          never modifies - your inbox, and only fetches messages matching receipt-shaped queries.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Pill tone="success">Connected</Pill>
        <span className="t-caption">Look back</span>
        <select value={sinceDays} onChange={e => setSinceDays(parseInt(e.target.value))}
                style={{
                  padding: '6px 8px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                  color: 'var(--fg)', fontSize: 12,
                }}>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>1 year</option>
        </select>
        <Btn variant="primary" onClick={go} disabled={busy}>{busy ? 'Scanning…' : 'Sync receipts'}</Btn>
      </div>
      {lastSync && <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Last sync: {new Date(lastSync).toLocaleString()}</div>}
      {msg && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{msg}</div>}
    </div>
  );
}
