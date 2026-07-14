'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, ChipBtn } from './atoms';

// Other accounts the user might pick as the merge destination.
type Opt = { id: string; name: string; mask: string | null; institution: string; txCount: number };

export default function AccountMergeBtn({ sourceId, sourceName, sourceMask, sourceTxCount, others }: {
  sourceId: string; sourceName: string; sourceMask: string | null; sourceTxCount: number;
  others: Opt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [destId, setDestId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Same-mask matches get suggested at the top of the picker.
  const ranked = [...others].sort((a, b) => {
    const aMatch = !!(sourceMask && a.mask && a.mask === sourceMask);
    const bMatch = !!(sourceMask && b.mask && b.mask === sourceMask);
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return b.txCount - a.txCount;
  });

  const dest = ranked.find(o => o.id === destId);

  async function doMerge() {
    if (!destId) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/accounts/${sourceId}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoAccountId: destId }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Merge failed'); setBusy(false); return; }
      setBusy(false); setOpen(false); router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  if (others.length === 0) return null;

  return (
    <>
      <ChipBtn
        onClick={() => { setOpen(true); setConfirming(false); setErr(null); setDestId(''); }}
        title="Merge this account into another"
      >⇢ Merge</ChipBtn>

      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'grid', placeItems: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 520, maxWidth: '90vw', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 14,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div className="t-caption">Merge account</div>
            <div style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
              <strong>{sourceName}</strong>
              {sourceMask && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', marginLeft: 6 }}>· {sourceMask}</span>}
              <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>({sourceTxCount} tx)</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              All transactions, receipts, orders, and goals on this account will move to the destination.
              Transactions that already exist on the destination (by hash) are dropped - same charge
              shouldn't end up twice. This is irreversible.
            </div>

            {!confirming ? (
              <>
                <div>
                  <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Merge into</label>
                  <select value={destId} onChange={e => setDestId(e.target.value)} style={{
                    width: '100%', height: 36, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                    background: 'var(--bg)', color: 'var(--fg)',
                    fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
                  }}>
                    <option value="">Pick destination account…</option>
                    {ranked.map(o => {
                      const sameMask = !!(sourceMask && o.mask && o.mask === sourceMask);
                      return (
                        <option key={o.id} value={o.id}>
                          {sameMask ? '★ ' : ''}{o.name}
                          {o.mask ? ` · ${o.mask}` : ''}
                          {` · ${o.txCount} tx`}
                          {sameMask ? '  (same mask)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn>
                  <Btn variant="primary" disabled={!destId || busy} onClick={() => setConfirming(true)}>
                    Continue →
                  </Btn>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                  Move <strong>{sourceTxCount} transactions</strong> from <strong>{sourceName}</strong> →
                  <strong> {dest?.name}</strong> and delete the source account?
                </div>
                {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>← Back</Btn>
                  <Btn variant="primary" onClick={doMerge} disabled={busy}>
                    {busy ? 'Merging…' : 'Merge & delete source'}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
