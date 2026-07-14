'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KIND_LABELS, KIND_ORDER, type AccountKind } from '@/lib/accountKind';

export default function AccountKindSelector({ accountId, current, inferred }: {
  accountId: string;
  current: AccountKind | null;
  inferred: AccountKind;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(current ?? '');
  const [busy, setBusy] = useState(false);

  async function onChange(next: string) {
    setValue(next);
    setBusy(true);
    await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: next || null }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={busy}
      title={current ? `Set to ${KIND_LABELS[current as AccountKind]}` : `Auto: ${KIND_LABELS[inferred]}`}
      style={{
        height: 28, padding: '0 8px',
        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
        background: current ? 'var(--bg-elevated)' : 'transparent',
        color: current ? 'var(--fg-strong)' : 'var(--fg-muted)',
        fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
        cursor: busy ? 'wait' : 'pointer',
      }}>
      <option value="">Auto: {KIND_LABELS[inferred]}</option>
      {KIND_ORDER.map(k => (
        <option key={k} value={k}>{KIND_LABELS[k]}</option>
      ))}
    </select>
  );
}
