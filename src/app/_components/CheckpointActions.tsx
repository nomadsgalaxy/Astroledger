'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

/**
 * Checkpoints aren't stored - they're computed live from whichever plan is
 * currently `active`. To "delete" the checkpoint a user needs to remove that
 * underlying plan, which is what this affordance does.
 */
export default function CheckpointActions({ activePlanId, activePlanName }: { activePlanId: string | null; activePlanName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function deactivate() {
    if (!activePlanId) return;
    if (!confirm(`Deactivate "${activePlanName}"? The plan stays in /plans (you can re-activate or delete it from there). The checkpoint will go blank until another plan is activated.`)) return;
    setBusy(true);
    await fetch('/api/plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', planId: activePlanId }),
    });
    setBusy(false);
    router.refresh();
  }

  async function destroy() {
    if (!activePlanId) return;
    if (!confirm(`Delete "${activePlanName}" entirely? Plan lines will be removed. Transactions are unaffected.`)) return;
    setBusy(true);
    await fetch(`/api/plans/${activePlanId}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  if (!activePlanId) return null;
  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Btn variant="ghost" size="sm" disabled={busy} onClick={deactivate}>Deactivate plan</Btn>
      <Btn variant="ghost" size="sm" disabled={busy} onClick={destroy} style={{ color: 'var(--error)' }}>Delete plan</Btn>
    </div>
  );
}
