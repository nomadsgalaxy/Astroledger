'use client';
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Btn } from './atoms';

export default function PasskeyEnrollButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const opts = await fetch('/api/webauthn/register/options', { method: 'POST' }).then(r => r.json());
      const resp = await startRegistration(opts);
      const r = await fetch('/api/webauthn/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp),
      });
      const data = await r.json();
      if (!r.ok) setMsg(`Failed: ${data.error}`);
      else { setMsg('Passkey enrolled.'); setTimeout(() => location.reload(), 700); }
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Btn variant="primary" onClick={go} disabled={busy}>{busy ? 'Enrolling…' : 'Enroll a passkey'}</Btn>
      {msg && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{msg}</div>}
    </div>
  );
}
