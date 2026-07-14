'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

// Settings UI: choose how many months of inactivity hides an account. 0 = off.
export default function InactiveAccountsCard({ initialMonths }: { initialMonths: number }) {
  const router = useRouter();
  const [months, setMonths] = useState(initialMonths);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: number) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/settings/inactive-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error || `Failed (${r.status})`);
      } else {
        const j = await r.json();
        setMonths(j.months); setSaved(j.months);
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        Accounts with no transactions for this many months are auto-hidden from the
        Accounts page, the account picker, and rollup totals - they stay in the database
        and reappear immediately if a fresh transaction lands. Set to <code>0</code> to disable.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="number"
          min="0"
          max="120"
          value={months}
          onChange={e => setMonths(parseInt(e.target.value || '0', 10))}
          disabled={busy}
          style={{
            width: 80, height: 36, padding: '0 12px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg)',
            fontFamily: 'var(--font-mono)', fontSize: 14, textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>
          {months === 0 ? 'disabled - show all accounts' : `month${months === 1 ? '' : 's'} of inactivity`}
        </span>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" size="md" onClick={() => save(months)} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Btn>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[0, 3, 6, 12, 24, 36].map(n => (
          <button key={n} onClick={() => { setMonths(n); save(n); }} disabled={busy}
                  style={presetBtn(n === months)}>
            {n === 0 ? 'Off' : `${n}m`}
          </button>
        ))}
      </div>
      {saved != null && !busy && !err && (
        <div style={{ fontSize: 11, color: 'var(--success)' }}>
          Saved: {saved === 0 ? 'auto-hide disabled' : `accounts inactive for ${saved}+ months are now hidden`}.
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: 'var(--error)' }}>{err}</div>}
    </div>
  );
}

function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
    letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
    padding: '6px 12px', borderRadius: 'var(--r-xs)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
    cursor: 'pointer',
  };
}
