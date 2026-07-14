'use client';

import { useState } from 'react';
import { Btn } from './atoms';

export default function DismissTtlSetting({ initial }: { initial: number }) {
  const [days, setDays] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings/dismiss-ttl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const json = await r.json();
      if (!r.ok) { setMsg(`Error: ${json.error}`); return; }
      setDays(json.days);
      setMsg(`Saved (${json.days} day${json.days === 1 ? '' : 's'}).`);
    } finally {
      setBusy(false);
    }
  }

  const dirty = days !== initial;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          Auto-delete dismissed alerts after
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{
              width: 80, padding: '6px 10px',
              border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
              background: 'var(--bg-subtle)', color: 'var(--fg)',
              fontFamily: 'var(--font-mono)', fontSize: 13,
            }}
          />
          <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            day{days === 1 ? '' : 's'}
          </span>
        </div>
      </label>
      <Btn variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>
        {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </Btn>
      {msg && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{msg}</span>}
    </div>
  );
}
