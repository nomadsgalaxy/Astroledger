'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill } from './atoms';

type Suggestion = {
  merchant: string; category: string; count: number; total: number; confidence: number;
  rule: { name: string; matchField: string; matchType: string; matchValue: string; caseInsensitive: boolean; applyCategory: string };
};

export default function SuggestedRules() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function load() {
    const r = await fetch('/api/rules/suggest');
    if (r.ok) setSuggestions((await r.json()).suggestions);
    else setSuggestions([]);
  }
  useEffect(() => { load(); }, []);

  async function accept(s: Suggestion) {
    setBusy(s.merchant);
    try {
      const r = await fetch('/api/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s.rule),
      });
      if (r.ok) { setDismissed(d => new Set(d).add(s.merchant)); router.refresh(); }
    } finally { setBusy(null); }
  }

  if (suggestions === null) return <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Scanning your categorizations…</div>;
  const visible = suggestions.filter(s => !dismissed.has(s.merchant));
  if (visible.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>No new rule suggestions — your consistently-categorized merchants are already covered by rules.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
        You keep filing these merchants under the same category. Accept a suggestion to auto-categorize future (and re-run on past) transactions.
      </div>
      {visible.map(s => (
        <div key={s.merchant} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-subtle)' }}>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: 'var(--fg-strong)' }}>{s.merchant}</strong>
            <span style={{ color: 'var(--fg-muted)' }}> → </span>
            <Pill tone="info" style={{ fontSize: 9 }}>{s.category}</Pill>
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
            {s.count}/{s.total} txns · {(s.confidence * 100).toFixed(0)}%
          </span>
          <Btn variant="primary" size="sm" disabled={busy === s.merchant} onClick={() => accept(s)}>
            {busy === s.merchant ? 'Adding…' : '+ Add rule'}
          </Btn>
        </div>
      ))}
    </div>
  );
}
