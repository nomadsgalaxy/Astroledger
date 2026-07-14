'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, ChipBtn } from './atoms';
import { COMMON_CURRENCIES } from '@/lib/currencies';

type FxRate = { id: string; date: string; quote: string; rate: number; source: string };

export default function FxRatesCard() {
  const router = useRouter();
  const [rates, setRates] = useState<FxRate[] | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quote, setQuote] = useState('EUR');
  const [rate, setRate] = useState('0.92');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fx-rates').then(r => r.json()).then(j => setRates(
      (j.rates ?? []).map((r: any) => ({ ...r, date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10) }))
    ));
  }, []);

  async function refresh() {
    const j = await (await fetch('/api/fx-rates')).json();
    setRates((j.rates ?? []).map((r: any) => ({ ...r, date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10) })));
  }

  async function add() {
    const r = parseFloat(rate);
    if (!Number.isFinite(r) || r <= 0) { setErr('Rate must be > 0'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/fx-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, quote: quote.toUpperCase(), rate: r, source: 'manual' }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Failed (${res.status})`); return; }
      await refresh();
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/fx-rates/${id}`, { method: 'DELETE' });
      if (r.ok) { await refresh(); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function backfill() {
    setBusy(true); setBackfillMsg(null);
    try {
      const r = await fetch('/api/fx-rates/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      setBackfillMsg(`Updated ${j.updated} transactions; ${j.missing} still missing a rate.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  // Most recent rate per quote - collapse history so the table doesn't
  // explode after a few months of daily seeds.
  const latestPerQuote = (() => {
    if (!rates) return [];
    const seen = new Set<string>();
    return rates.filter(r => {
      if (seen.has(r.quote)) return false;
      seen.add(r.quote); return true;
    });
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        Base currency: <strong>USD</strong>. Rates are stored as <code>1 USD = rate × quote</code>.
        Astroledger looks up the most recent rate at or before each foreign-currency charge date.
      </div>

      {latestPerQuote.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr auto', gap: 10, alignItems: 'center' }}>
          <div className="t-caption">Quote</div>
          <div className="t-caption" style={{ textAlign: 'right' }}>Rate</div>
          <div className="t-caption">As of</div>
          <div />
          {latestPerQuote.map(r => (
            <FxRow key={r.id} r={r} onDelete={() => remove(r.id)} disabled={busy} />
          ))}
        </div>
      )}

      <div style={{
        marginTop: 6, padding: 12,
        border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)',
        display: 'grid', gridTemplateColumns: '140px 120px 140px auto', gap: 10, alignItems: 'center',
      }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        <select value={quote} onChange={e => setQuote(e.target.value)} style={inp}>
          {COMMON_CURRENCIES.filter(c => c !== 'USD').map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min="0" step="0.0001" value={rate} onChange={e => setRate(e.target.value)} style={inp} placeholder="1 USD = ?" />
        <Btn variant="primary" size="sm" onClick={add} disabled={busy}>+ Save rate</Btn>
      </div>
      {err && <span style={{ fontSize: 12, color: 'var(--error)' }}>{err}</span>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <Btn variant="outline" size="sm" onClick={backfill} disabled={busy}>↻ Backfill transactions</Btn>
        {backfillMsg && <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{backfillMsg}</span>}
      </div>
    </div>
  );
}

function FxRow({ r, onDelete, disabled }: { r: FxRate; onDelete: () => void; disabled: boolean }) {
  return (
    <>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--fg-strong)' }}>{r.quote}</div>
      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.rate.toFixed(4)}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
        {r.date} <Pill tone="ghost" style={{ marginLeft: 6, fontSize: 9 }}>{r.source}</Pill>
      </div>
      <ChipBtn tone="danger" onClick={onDelete} disabled={disabled}>✕</ChipBtn>
    </>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
