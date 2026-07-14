'use client';
import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Btn } from './atoms';

export default function PasskeySignInButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const opts = await fetch('/api/webauthn/authenticate/options', { method: 'POST' }).then(r => r.json());
      const resp = await startAuthentication(opts);
      const v = await fetch('/api/webauthn/authenticate/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp),
      });
      if (!v.ok) { setErr((await v.json()).error || 'Failed'); setBusy(false); return; }
      window.location.href = '/';
    } catch (e: any) { setErr(e.message ?? 'No passkey available'); setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Btn variant="primary" onClick={go} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
        {busy ? 'Verifying…' : 'Sign in with passkey'}
      </Btn>
      {err && <div style={{ fontSize: 11, color: 'var(--error)' }}>{err}</div>}
    </div>
  );
}
