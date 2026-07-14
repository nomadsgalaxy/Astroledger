'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function PlanActions({ planId, status }: { planId?: string; status?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(body: any) {
    setBusy(true);
    const r = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) router.refresh();
  }

  async function destroy() {
    if (!planId) return;
    if (!confirm('Delete this plan? Its lines will be removed. Historical transactions are not affected.')) return;
    setBusy(true);
    const r = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) router.refresh();
  }

  if (!planId) {
    return (
      <Btn variant="primary" disabled={busy}
           onClick={() => call({ action: 'createFromForecast', name: `Plan ${new Date().toLocaleDateString()}`, months: 12, activate: true })}>
        {busy ? 'Creating…' : 'Create from forecast'}
      </Btn>
    );
  }

  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      {status !== 'active' && status !== 'superseded' && (
        <Btn variant="outline" size="sm" disabled={busy} onClick={() => call({ action: 'activate', planId })}>Activate</Btn>
      )}
      {status !== 'archived' && (
        <Btn variant="ghost" size="sm" disabled={busy} onClick={() => call({ action: 'archive', planId })}>Archive</Btn>
      )}
      <Btn variant="ghost" size="sm" disabled={busy} onClick={destroy}
           style={{ color: 'var(--error)' }}>Delete</Btn>
    </div>
  );
}
