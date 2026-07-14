'use client';
import { useState } from 'react';
import { Btn } from './atoms';
import SimpleFinForm from './SimpleFinForm';

// Pop-up wrapper around SimpleFinForm in reconnect mode - opened from the
// "Needs reconnect" card on /connect.
export default function SimpleFinReconnectBtn({ institutionId, institutionName }: {
  institutionId: string; institutionName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="primary" size="md" icon="↻" onClick={() => setOpen(true)}>Reconnect</Btn>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'grid', placeItems: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 520, maxWidth: '90vw', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 14,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div className="t-caption">Reconnect SimpleFIN</div>
            <div style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{institutionName}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
              Existing accounts and transaction history stay put - pasting a fresh Setup Token
              just updates the access URL on this institution row.
            </div>
            <SimpleFinForm reconnectInstitutionId={institutionId} reconnectName={institutionName} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setOpen(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
