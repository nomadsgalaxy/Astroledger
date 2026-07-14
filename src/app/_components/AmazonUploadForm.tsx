'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

type ImportResult = {
  created?: number;
  itemsAdded?: number;
  skipped?: number;
  matched?: number;
  rowCount?: number;
  uploadKind?: 'zip' | 'csv';
  extractedFrom?: string | null;
  headerSample?: string[];
  skippedReasons?: { noOrderId: number; noDate: number; noTotal: number; cancelled: number; duplicate: number };
  error?: string;
};

export default function AmazonUploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/orders/amazon', { method: 'POST', body: fd });
    const json: ImportResult = await res.json();
    setResult(res.ok ? json : { error: json.error ?? 'Import failed' });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
        Upload Amazon&apos;s <strong>Your Orders.zip</strong> straight from{' '}
        <a href="https://www.amazon.com/hz/privacy-central/data-requests/preview.html"
           target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Privacy Central → Request my data → Your Orders
        </a>
        , or extract <strong>Your Amazon Orders/Order History.csv</strong> and upload that
        directly. Legacy <code>Retail.OrderHistory.csv</code> still works.
      </div>
      <input type="file" name="file" accept=".csv,.zip" required
             style={{ fontSize: 13, color: 'var(--fg-muted)' }} />
      <Btn variant="primary" type="submit" disabled={busy}>
        {busy ? 'Importing…' : 'Import Amazon orders'}
      </Btn>

      {result && <ResultPanel r={result} />}
    </form>
  );
}

function ResultPanel({ r }: { r: ImportResult }) {
  if (r.error) {
    return (
      <div style={{
        padding: 12, fontSize: 12, color: 'var(--error)',
        background: 'rgba(237,0,0,0.06)', border: '1px solid rgba(237,0,0,0.3)',
        borderRadius: 'var(--r-sm)', lineHeight: 1.5,
      }}>
        <strong>Import failed.</strong> {r.error}
      </div>
    );
  }
  const reasons = r.skippedReasons;
  const reasonText = reasons
    ? Object.entries(reasons)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ') || 'none'
    : null;
  const importedNothing = (r.created ?? 0) === 0;
  return (
    <div style={{
      padding: 12, fontSize: 12, color: 'var(--fg-muted)',
      background: 'var(--bg-subtle)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)', lineHeight: 1.6,
    }}>
      <div style={{ color: importedNothing ? 'var(--warning)' : 'var(--fg-strong)', fontWeight: 600, marginBottom: 6 }}>
        Imported {r.created ?? 0} orders ({r.itemsAdded ?? 0} items), matched {r.matched ?? 0} to existing charges.
      </div>
      <div>
        Read {r.rowCount ?? 0} rows from {r.uploadKind === 'zip' ? 'zip' : 'CSV'}
        {r.extractedFrom ? <> (extracted <code style={{ fontSize: 11 }}>{r.extractedFrom}</code>)</> : null}.
      </div>
      {r.skipped !== undefined && r.skipped > 0 && reasonText && (
        <div style={{ marginTop: 4 }}>Skipped {r.skipped} - reasons: {reasonText}.</div>
      )}
      {importedNothing && r.headerSample && r.headerSample.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <strong>0 imported.</strong> The parser saw these columns: <code style={{ fontSize: 11 }}>{r.headerSample.join(', ')}</code>.
          Expected at minimum: <code style={{ fontSize: 11 }}>Order ID</code>, <code style={{ fontSize: 11 }}>Order Date</code>,
          and one of <code style={{ fontSize: 11 }}>Total Amount</code> / <code style={{ fontSize: 11 }}>Order Total (USD)</code> /
          <code style={{ fontSize: 11 }}>Shipment Item Subtotal</code>. If your file looks different,
          check that you uploaded <strong>Order History.csv</strong> (not Cart History, Returns, or another file from the export).
        </div>
      )}
    </div>
  );
}
