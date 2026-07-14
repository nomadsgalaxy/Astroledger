'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function PlaidLinkButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.link_token) setToken(d.link_token); else setError(d.error ?? 'Plaid error'); })
      .catch(e => setError(e.message));
  }, []);

  const onSuccess = useCallback(async (public_token: string, metadata: any) => {
    setStatus('Exchanging token…');
    const res = await fetch('/api/plaid/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_token, institution_name: metadata?.institution?.name ?? 'Bank' }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(`Error: ${data.error}`); return; }
    setStatus(`Synced ${data.added} new, ${data.modified} modified.`);
    router.refresh();
  }, [router]);

  const { open, ready } = usePlaidLink({ token: token ?? '', onSuccess });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Btn variant="primary" disabled={!ready || !token} onClick={() => open()}>
        {token ? 'Open Plaid Link' : 'Loading…'}
      </Btn>
      {error && <div style={{ fontSize: 11, color: 'var(--error)' }}>{error}</div>}
      {status && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{status}</div>}
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Sandbox: <code>user_good</code> / <code>pass_good</code></div>
    </div>
  );
}
