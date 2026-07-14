'use client';

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DropdownPortal from './DropdownPortal';

const LOOKBACK_OPTIONS: Array<{ key: string; label: string; days: number }> = [
  { key: '30d',  label: '30 days',  days: 30 },
  { key: '90d',  label: '90 days',  days: 90 },
  { key: '6mo',  label: '6 months', days: 180 },
  { key: '12mo', label: '12 months', days: 365 },
  { key: '24mo', label: '24 months', days: 730 },
  { key: '36mo', label: '36 months', days: 1095 },
];

type Result = {
  results: Array<{ institution: string; source: string; added?: number; updated?: number; skipped?: boolean; error?: string }>;
  totals: { added: number; updated: number; attempted: number };
};

/**
 * Refresh button with lookback dropdown. Use with institutionId=null to refresh
 * every connected institution, or pass an id for a single-row refresh.
 *
 * Defaults to 12 months - SimpleFIN/PayPal both cap meaningful lookback at ~1y
 * by default; their APIs technically support more (3y for PayPal) so we expose it.
 */
export default function RefreshInstitutionBtn({ institutionId = null, label = 'Refresh', defaultKey = '12mo', size = 'md' }: {
  institutionId?: string | null;
  label?: string;
  defaultKey?: string;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string>(defaultKey);
  const [result, setResult] = useState<Result | null>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const chosenOpt = LOOKBACK_OPTIONS.find(o => o.key === chosen) ?? LOOKBACK_OPTIONS[3];

  const run = async (days: number, key: string) => {
    setChosen(key);
    setOpen(false);
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch('/api/institutions/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId, sinceDays: days }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Refresh failed');
      setResult(data);
      startTransition(() => router.refresh());
      setTimeout(() => setResult(null), 12_000);
    } catch (err) {
      alert('Refresh failed: ' + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const h = size === 'sm' ? 28 : 34;
  const fs = size === 'sm' ? 10 : 11;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ display: 'flex' }}>
        <button
          onClick={() => run(chosenOpt.days, chosenOpt.key)}
          disabled={running}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: h, padding: size === 'sm' ? '0 10px' : '0 14px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: fs,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1,
          }}>
          <span style={{ color: 'var(--accent)' }}>↻</span>
          {running ? 'Refreshing…' : `${label} ${chosenOpt.label}`}
        </button>
        <button
          ref={caretRef}
          onClick={() => setOpen(o => !o)}
          disabled={running}
          style={{
            height: h, padding: '0 8px',
            border: '1px solid var(--border)', borderLeft: 0,
            borderRadius: '0 var(--r-sm) var(--r-sm) 0',
            background: 'var(--bg-elevated)', color: 'var(--fg-muted)',
            fontSize: 10, cursor: 'pointer',
          }}
          title="Choose lookback">▾</button>
      </div>
      <DropdownPortal triggerRef={caretRef} open={open} onClose={() => setOpen(false)} width={200} align="end" maxHeight={320}>
        <div className="t-caption" style={{ padding: '4px 8px 6px' }}>Lookback window</div>
        {LOOKBACK_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => run(opt.days, opt.key)}
            style={{
              display: 'flex', justifyContent: 'space-between', width: '100%',
              padding: '8px 10px', borderRadius: 'var(--r-xs)', border: 'none',
              background: chosen === opt.key ? 'var(--bg-subtle)' : 'transparent',
              color: chosen === opt.key ? 'var(--accent)' : 'var(--fg)',
              fontSize: 13, fontWeight: chosen === opt.key ? 600 : 400,
              cursor: 'pointer', textAlign: 'left',
            }}>
            <span>{opt.label}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>{opt.days}d</span>
          </button>
        ))}
      </DropdownPortal>
      <DropdownPortal triggerRef={containerRef} open={!!result} onClose={() => setResult(null)} width={360} align="end" maxHeight={420}>
        {result && (
          <div style={{ padding: 8, fontSize: 12 }}>
            <div style={{
              fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)',
              textTransform: 'uppercase', fontSize: 10, color: 'var(--accent)', marginBottom: 8,
            }}>
              {result.totals.added} added · {result.totals.updated} updated · {result.totals.attempted} sources
            </div>
            {result.results.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < result.results.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ color: 'var(--fg)' }}>
                  {r.institution} <span style={{ color: 'var(--fg-subtle)' }}>· {r.source}</span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {r.error ? <span style={{ color: 'var(--error)' }} title={r.error}>error</span>
                    : r.skipped ? <span style={{ color: 'var(--fg-subtle)' }}> - </span>
                    : <span style={{ color: 'var(--success)' }}>+{r.added ?? 0} / ~{r.updated ?? 0}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </DropdownPortal>
    </div>
  );
}
