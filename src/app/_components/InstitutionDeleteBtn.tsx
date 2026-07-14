'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, ChipBtn } from './atoms';

// Pop-up on each /connect institution row - offers two distinct actions:
//   • Disconnect: null the access token, keep accounts + history
//   • Delete:     full remove, cascades to accounts + transactions
// Two-step confirm on delete since it's irreversible.
export default function InstitutionDeleteBtn({ institutionId, institutionName, accountCount, txCount, canDisconnect }: {
  institutionId: string;
  institutionName: string;
  accountCount: number;
  txCount: number;
  canDisconnect: boolean;          // false for upload-only sources where there's no token to clear
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'confirmDisconnect' | 'confirmDelete'>('menu');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(keepData: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/institutions/${institutionId}${keepData ? '?keepData=true' : ''}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || `Failed (${r.status})`); setBusy(false); return; }
      setBusy(false); setOpen(false); setMode('menu'); router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  return (
    <>
      <ChipBtn
        onClick={() => { setOpen(true); setMode('menu'); setErr(null); }}
        title="Remove this institution"
        style={{ marginLeft: 6 }}
      >⋯</ChipBtn>

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
            <div className="t-caption">Remove institution</div>
            <div style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
              <strong>{institutionName}</strong>
              <span style={{ color: 'var(--fg-muted)', marginLeft: 8, fontSize: 12 }}>
                {accountCount} account{accountCount === 1 ? '' : 's'} · {txCount} transaction{txCount === 1 ? '' : 's'}
              </span>
            </div>

            {mode === 'menu' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {canDisconnect && (
                    <button onClick={() => setMode('confirmDisconnect')} style={menuBtn}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg-strong)' }}>Disconnect</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.5 }}>
                        Stop syncing. The {accountCount} account{accountCount === 1 ? '' : 's'} and {txCount} historical transaction{txCount === 1 ? '' : 's'} stay in Astroledger.
                        Reconnect any time with a fresh setup token.
                      </div>
                    </button>
                  )}
                  <button onClick={() => setMode('confirmDelete')} style={{ ...menuBtn, borderColor: 'var(--error)' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--error)' }}>Delete</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.5 }}>
                      Permanently remove the institution AND its {accountCount} account{accountCount === 1 ? '' : 's'} AND {txCount} transaction{txCount === 1 ? '' : 's'}.
                      Receipts attached to those transactions are also deleted. Irreversible.
                    </div>
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
                </div>
              </>
            )}

            {mode === 'confirmDisconnect' && (
              <>
                <div style={{ padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                  Disconnect <strong>{institutionName}</strong>? The {accountCount} account{accountCount === 1 ? '' : 's'} stay put with all
                  {' '}{txCount} historical transaction{txCount === 1 ? '' : 's'}; only future syncs stop until you reconnect.
                </div>
                {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setMode('menu')} disabled={busy}>← Back</Btn>
                  <Btn variant="primary" onClick={() => run(true)} disabled={busy}>
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </Btn>
                </div>
              </>
            )}

            {mode === 'confirmDelete' && (
              <>
                <div style={{ padding: 14, background: 'rgba(213, 50, 50, 0.08)', border: '1px solid rgba(213, 50, 50, 0.3)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--error)' }}>⚠ This is permanent</div>
                  Delete <strong>{institutionName}</strong>, its {accountCount} account{accountCount === 1 ? '' : 's'},
                  {' '}all {txCount} transaction{txCount === 1 ? '' : 's'}, and any attached receipts. Cannot be undone.
                </div>
                {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setMode('menu')} disabled={busy}>← Back</Btn>
                  <Btn variant="primary" onClick={() => run(false)} disabled={busy} style={{ background: 'var(--error)' }}>
                    {busy ? 'Deleting…' : 'Delete forever'}
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

const menuBtn: React.CSSProperties = {
  textAlign: 'left', padding: 14, borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--bg)',
  cursor: 'pointer', display: 'block', width: '100%',
};
