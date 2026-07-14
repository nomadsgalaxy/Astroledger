'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function PayPalForm() {
  const router = useRouter();
  const [name, setName] = useState('PayPal');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [env, setEnv] = useState<'live' | 'sandbox'>('live');
  const [sinceDays, setSinceDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await fetch('/api/paypal/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clientId: clientId.trim(), secret: secret.trim(), env, sinceDays }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg(`Error: ${j.error}`); setBusy(false); return; }
    setMsg(`Linked - imported ${j.added} transactions (${j.windows} window${j.windows === 1 ? '' : 's'} scanned).`);
    setClientId(''); setSecret('');
    setBusy(false);
    router.refresh();
  }

  const input = {
    width: '100%', height: 36, padding: '0 12px',
    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
    background: 'var(--bg-elevated)', color: 'var(--fg)',
    fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
  } as const;

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Display name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={input} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 }}>
        <div>
          <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Client ID</label>
          <input value={clientId} onChange={e => setClientId(e.target.value)} required
                 style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 11 }} />
        </div>
        <div>
          <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Environment</label>
          <select value={env} onChange={e => setEnv(e.target.value as 'live' | 'sandbox')} style={input}>
            <option value="live">Live</option>
            <option value="sandbox">Sandbox</option>
          </select>
        </div>
      </div>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Secret</label>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} required
               style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 11 }} />
      </div>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Initial backfill (days)</label>
        <input type="number" min={1} max={365} value={sinceDays}
               onChange={e => setSinceDays(parseInt(e.target.value) || 90)} style={input} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
        Get keys at <a style={{ color: 'var(--accent)' }} href="https://developer.paypal.com/dashboard/applications/" target="_blank" rel="noreferrer">developer.paypal.com</a> → Apps & Credentials → create a REST app. Requires a <strong>PayPal Business</strong> account with <strong>Transaction Search</strong> enabled on the app (Personal accounts can't use this API - use CSV import instead). Credentials are validated, then encrypted in your local DB.
      </div>
      <Btn variant="primary" type="submit" disabled={busy || !clientId.trim() || !secret.trim()}>
        {busy ? 'Connecting…' : 'Connect PayPal API'}
      </Btn>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}
    </form>
  );
}
