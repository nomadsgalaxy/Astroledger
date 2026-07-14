'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

const inputStyle = {
  width: '100%', height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
} as const;
const labelStyle = { display: 'block', marginBottom: 6 } as const;

export default function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setResult(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) { setResult(`Error: ${json.error}`); setBusy(false); return; }
    setResult(`Imported ${json.inserted} (skipped ${json.skipped}), detected ${json.subscriptions?.total ?? 0} subscriptions.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label className="t-caption" style={labelStyle}>Institution</label>
        <input name="institutionName" required placeholder="Chase" style={inputStyle} />
      </div>
      <div>
        <label className="t-caption" style={labelStyle}>Account name</label>
        <input name="accountName" required placeholder="Chase Sapphire" style={inputStyle} />
      </div>
      <div>
        <label className="t-caption" style={labelStyle}>Sign convention</label>
        <select name="signConvention" style={inputStyle}>
          <option value="standard">Standard (negative = outflow)</option>
          <option value="inverted">Inverted (positive = outflow)</option>
        </select>
      </div>
      <div>
        <label className="t-caption" style={labelStyle}>CSV file</label>
        <input type="file" name="file" accept=".csv" required style={{ fontSize: 13, color: 'var(--fg-muted)' }} />
      </div>
      <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Importing…' : 'Import CSV'}</Btn>
      {result && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{result}</div>}
    </form>
  );
}
