'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

// Period picker + export actions for the financial-statements page. Client-only
// so the date inputs and window.print() work; the statements themselves render
// server-side for fast SSR + correct numbers.
const input: React.CSSProperties = {
  height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};

export default function StatementsControls({ from, to, csvAllHref }: { from: string; to: string; csvAllHref: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const apply = () => {
    const qs = new URLSearchParams({ from: f, to: t }).toString();
    router.push(`/reports/statements?${qs}`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="t-caption">From</span>
        <input type="date" value={f} max={t} onChange={e => setF(e.target.value)} style={input} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="t-caption">To</span>
        <input type="date" value={t} min={f} onChange={e => setT(e.target.value)} style={input} />
      </label>
      <Btn variant="primary" size="md" onClick={apply}>Apply</Btn>
      <div style={{ flex: 1 }} />
      <Btn variant="outline" size="md" icon="↓" onClick={() => { window.location.href = csvAllHref; }}>CSV (all)</Btn>
      <Btn variant="primary" size="md" icon="⎙" onClick={() => window.print()}>Print / Save as PDF</Btn>
    </div>
  );
}
