'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

// `reconnectInstitutionId` switches the form into reconnect mode: a new setup
// token attaches to the existing institution row instead of creating a new one.
// Used on /connect when SimpleFIN dropped the access token.
export default function SimpleFinForm({ reconnectInstitutionId, reconnectName }: {
  reconnectInstitutionId?: string; reconnectName?: string;
} = {}) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [name, setName] = useState(reconnectName ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Probe the vault BEFORE sending the one-time setup token. If the vault is
  // locked (route would normally discover this AFTER claiming the token),
  // bail out early and tell the user to re-sign-in.
  async function preflight(): Promise<string | null> {
    try {
      const r = await fetch('/api/auth/vault-status', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.unlocked) return null;
        return j.error || 'Vault is locked.';
      }
    } catch { /* fall through - let the real request handle it */ }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true); setMsg(null);
    const preErr = await preflight();
    if (preErr) {
      setMsg(`${preErr} Sign out and back in, then paste your token (it is NOT consumed yet).`);
      setBusy(false);
      return;
    }
    const res = await fetch('/api/simplefin/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupToken: token.trim(),
        name: name.trim() || undefined,
        ...(reconnectInstitutionId ? { reconnectInstitutionId } : {}),
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      // Tailored hints for the common failure modes - saves the user from
      // confusing wording like "403" with no context.
      if (j.code === 'VAULT_LOCKED') {
        setMsg(`${j.error}`);
      } else if (j.code === 'already_claimed') {
        setMsg(`This token has already been used. SimpleFIN tokens are one-time. Click "New Setup Token" at beta-bridge.simplefin.org and paste the fresh one.`);
        // Clear the burned token so the user can paste a new one.
        setToken('');
      } else if (j.code === 'invalid_token') {
        setMsg(`Token format looks wrong. Make sure you copied the entire base64 string from beta-bridge.simplefin.org (no leading/trailing whitespace).`);
      } else if (j.code === 'forbidden') {
        setMsg(`SimpleFIN bridge rejected the token (HTTP 403). Get a fresh one at beta-bridge.simplefin.org.`);
        setToken('');
      } else if (j.code === 'network') {
        setMsg(`Network error reaching SimpleFIN. Try again in a moment.`);
      } else {
        setMsg(`Error: ${j.error}`);
      }
      setBusy(false);
      return;
    }
    const verb = reconnectInstitutionId ? 'Reconnected' : 'Linked';
    setMsg(`${verb} ${j.accounts} account${j.accounts === 1 ? '' : 's'}, imported ${j.added} transactions.`);
    setToken(''); if (!reconnectInstitutionId) setName('');
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Display name (optional)</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="My banks"
          style={{
            width: '100%', height: 36, padding: '0 12px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg)',
            fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
          }} />
      </div>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Setup Token (paste from SimpleFIN Bridge)</label>
        <textarea value={token} onChange={e => setToken(e.target.value)} required rows={3}
          placeholder="aHR0cHM6Ly9iZXRhLWJyaWRnZS5z…"
          style={{
            width: '100%', padding: 10,
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg)',
            fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none', resize: 'vertical',
          }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
        Get a token at <a style={{ color: 'var(--accent)' }} href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">beta-bridge.simplefin.org</a> → connect your banks → click "Setup Token". Token is one-time use; we exchange it for a long-lived access URL stored encrypted in your local DB.
      </div>
      <Btn variant="primary" type="submit" disabled={busy || !token.trim()}>
        {busy ? (reconnectInstitutionId ? 'Reconnecting…' : 'Connecting…')
              : (reconnectInstitutionId ? 'Reconnect this institution' : 'Connect via SimpleFIN')}
      </Btn>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}
    </form>
  );
}
