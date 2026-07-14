'use client';
import { useState } from 'react';
import { Btn } from './atoms';

// Each export is a plain GET that streams a download. We trigger it via a
// hidden anchor so the browser handles the Content-Disposition attachment.
export default function ExportPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function download(format: 'csv' | 'qif' | 'json', label: string) {
    setBusy(format); setMsg(null);
    try {
      const res = await fetch(`/api/export?format=${format}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(`Error: ${j.error ?? res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `astroledger-export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg(`Downloaded ${name} (${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn variant="outline" size="sm" disabled={!!busy} onClick={() => download('csv', 'CSV')}>
          {busy === 'csv' ? 'Exporting…' : 'Transactions CSV'}
        </Btn>
        <Btn variant="outline" size="sm" disabled={!!busy} onClick={() => download('qif', 'QIF')}>
          {busy === 'qif' ? 'Exporting…' : 'Quicken QIF'}
        </Btn>
        <Btn variant="outline" size="sm" disabled={!!busy} onClick={() => download('json', 'JSON')}>
          {busy === 'json' ? 'Exporting…' : 'Full JSON dump'}
        </Btn>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
        <strong>CSV</strong> — every transaction + tags/category/flags, opens in any spreadsheet.{' '}
        <strong>QIF</strong> — multi-account Quicken format (round-trips back into Astroledger or any QIF-aware app).{' '}
        <strong>JSON</strong> — complete denormalized dump of every table (accounts, transactions, budgets, goals,
        rules, holdings, etc.) for archival or migration. Connector credentials are excluded.
      </div>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}
    </div>
  );
}
