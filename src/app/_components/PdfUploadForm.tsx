'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

type Account = { id: string; label: string };

type Result = {
  parsed: number;
  inserted: number;
  skipped: number;
  llmUsed: boolean;
  warnings: string[];
  preview: Array<{ date: string; description: string; amount: number }>;
};

const inputStyle = {
  width: '100%', height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
} as const;
const labelStyle = { display: 'block', marginBottom: 6 } as const;

export default function PdfUploadForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useExisting, setUseExisting] = useState(accounts.length > 0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setResult(null); setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/import/pdf', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) { setError(json.error || 'Import failed'); setBusy(false); return; }
    setResult(json);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)', alignSelf: 'flex-start' }}>
          <button type="button" onClick={() => setUseExisting(true)} style={tabBtn(useExisting)}>Existing account</button>
          <button type="button" onClick={() => setUseExisting(false)} style={tabBtn(!useExisting)}>New account</button>
        </div>
      )}

      {useExisting && accounts.length > 0 ? (
        <div>
          <label className="t-caption" style={labelStyle}>Import into</label>
          <select name="accountId" required style={inputStyle} defaultValue="">
            <option value="" disabled>Pick an account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      ) : (
        <>
          <div>
            <label className="t-caption" style={labelStyle}>Institution</label>
            <input name="institutionName" required={!useExisting} placeholder="e.g. PNC Bank" style={inputStyle} />
          </div>
          <div>
            <label className="t-caption" style={labelStyle}>Account name</label>
            <input name="accountName" required={!useExisting} placeholder="e.g. PNC Cash Rewards Visa" style={inputStyle} />
          </div>
        </>
      )}

      <div>
        <label className="t-caption" style={labelStyle}>Sign convention</label>
        <select name="signConvention" style={inputStyle} defaultValue="standard">
          <option value="standard">Standard (negative = outflow)</option>
          <option value="inverted">Inverted (positive = outflow)</option>
        </select>
      </div>

      <div>
        <label className="t-caption" style={labelStyle}>PDF statement(s)</label>
        <input type="file" name="file" accept="application/pdf,.pdf,.zip,application/zip" required style={{ fontSize: 13, color: 'var(--fg-muted)' }} />
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Single PDF or a ZIP of PDFs. Local LLM parses everything - nothing leaves your machine. Scanned image PDFs require OCR (not supported yet).
        </div>
      </div>

      <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Parsing PDF…' : 'Import PDF'}</Btn>
      {error && <div style={{ fontSize: 12, color: 'var(--error)' }}>{error}</div>}
      {result && (
        <div style={{
          padding: 12, background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <strong style={{ color: 'var(--success)' }}>{result.inserted} inserted</strong>
            {' · '}
            <span style={{ color: 'var(--fg-muted)' }}>{result.skipped} skipped (duplicates)</span>
            {' · '}
            <span style={{ color: 'var(--fg-muted)' }}>{result.parsed} parsed from PDF</span>
          </div>
          {result.warnings.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warning)', lineHeight: 1.5 }}>
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {result.preview.length > 0 && (
            <div>
              <div className="t-caption" style={{ marginBottom: 4 }}>Preview (first {result.preview.length})</div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                {result.preview.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: 8 }}>
                    <span>{t.date}</span>
                    <span style={{ color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</span>
                    <span style={{ textAlign: 'right', color: t.amount < 0 ? 'var(--accent)' : 'var(--success)' }}>
                      {t.amount > 0 ? '+' : ''}{t.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 'var(--r-xs)', border: 0,
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
    fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
    letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
    cursor: 'pointer',
  };
}
