'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

export default function EmailArchiveUploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg('Uploading + parsing…');
    const fd = new FormData(e.currentTarget);
    const r = await fetch('/api/orders/email-archive', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) { setMsg(`Error: ${j.error}`); setBusy(false); return; }
    setMsg(`Scanned ${j.scanned} emails · ${j.recognized} receipts recognized · ${j.imported} new, ${j.duplicates} duplicates · matched ${j.matched} to charges.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="file" name="file" accept=".eml,.mbox,.zip" required style={{ fontSize: 13, color: 'var(--fg-muted)' }} />
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
        Accepts a single <code>.eml</code>, a <code>.mbox</code> file (e.g. Google Takeout, Mac Mail export), or a
        <code>.zip</code> containing any combination. Uses the same per-merchant parsers as Gmail sync
        (Amazon, DoorDash, Uber, Apple, Lyft, Instacart, Etsy, Stripe-powered, etc). Max 200 MB.
      </div>
      <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Parsing…' : 'Upload + parse receipts'}</Btn>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}
    </form>
  );
}
