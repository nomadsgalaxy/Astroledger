'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Btn, Pill, fmt } from './atoms';
import type { TagOption } from './TagPicker';
import { ResizableTableShell } from './useResizableColumns';

type Log = {
  id: string;
  date: string;       // ISO yyyy-mm-dd
  miles: number;
  purpose: string;
  ratePerMile: number;
  tagId: string | null;
  notes: string | null;
  transactionId: string | null;
};

const MILEAGE_COLS = [
  { key: 'date',    width: 110, min: 80 },
  { key: 'purpose', flex: 1,    min: 200 },
  { key: 'miles',   width: 80,  min: 70 },
  { key: 'rate',    width: 80,  min: 70 },
  { key: 'amount',  width: 110, min: 90 },
  { key: 'status',  width: 140, min: 110 },
  { key: 'actions', width: 110, min: 90, resizable: false },
];

export default function MileageClient({ logs, tags, accounts, ytdMiles, ytdDollars }: {
  logs: Log[];
  tags: TagOption[];
  accounts: Array<{ id: string; label: string }>;
  ytdMiles: number;
  ytdDollars: number;
}) {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [miles, setMiles] = useState('');
  const [purpose, setPurpose] = useState('');
  const [rate, setRate] = useState('0.67');
  const [tagId, setTagId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [accId, setAccId] = useState<string>(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const m = parseFloat(miles);
    const r = parseFloat(rate);
    if (!purpose.trim() || !Number.isFinite(m) || m <= 0 || !Number.isFinite(r) || r <= 0) {
      setErr('Date, miles (>0), purpose, and rate required.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/mileage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, miles: m, purpose: purpose.trim(), ratePerMile: r,
          tagId: tagId || null, notes: notes.trim() || null,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Failed (${res.status})`); return; }
      setMiles(''); setPurpose(''); setNotes('');
      router.refresh();
    } finally { setBusy(false); }
  }

  async function materialize(id: string) {
    if (!accId) { setErr('Pick an account for the anticipated charge.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/mileage/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accId }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Failed (${res.status})`); return; }
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/mileage/${id}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `Failed (${r.status})`); return; }
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <Card padding={20}><Stat label="YTD miles" value={ytdMiles.toFixed(1)} /></Card>
        <Card padding={20}><Stat label="YTD deductible" value={fmt(ytdDollars)} color="var(--accent)" /></Card>
        <Card padding={20}><Stat label="Default rate" value={`$0.67 / mi`} /></Card>
      </div>

      <Card eyebrow="New entry" title="Log a trip"
            action={<Pill tone="info">2026 IRS standard</Pill>}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 90px 1fr 100px', gap: 10, marginBottom: 10 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          <input type="number" min="0" step="0.1" placeholder="miles" value={miles} onChange={e => setMiles(e.target.value)} style={inp} />
          <input placeholder="Purpose (client meeting, site visit, etc.)" value={purpose} onChange={e => setPurpose(e.target.value)} style={inp} />
          <input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)} style={inp} title="Rate per mile" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <select value={tagId} onChange={e => setTagId(e.target.value)} style={inp}>
            <option value="">No tag</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.parentName ? `${t.parentName} › ${t.name}` : t.name}</option>)}
          </select>
          <input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} style={inp} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Btn variant="primary" onClick={add} disabled={busy}>+ Add trip</Btn>
          {err && <span style={{ fontSize: 12, color: 'var(--error)' }}>{err}</span>}
        </div>
      </Card>

      <Card eyebrow="Materialize" title="Default account for new expense entries"
            action={<Pill tone="ghost">{accounts.length} accounts</Pill>}>
        <select value={accId} onChange={e => setAccId(e.target.value)} style={{ ...inp, width: '100%' }}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Converting a log creates an <strong>anticipated</strong> transaction on this account with the
          deductible amount. When the real expense (gas, lease) lands later, you can match them manually.
        </div>
      </Card>

      <Card padding={0} eyebrow="History" title={`${logs.length} entries`}>
        <ResizableTableShell storageKey="astroledger-cols-mileage" columns={MILEAGE_COLS} gap={12}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'var(--cols)',
            padding: '10px 22px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)', gap: 12,
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}>
            <span>Date</span><span>Purpose</span>
            <span style={{ textAlign: 'right' }}>Miles</span>
            <span style={{ textAlign: 'right' }}>Rate</span>
            <span style={{ textAlign: 'right' }}>Deductible</span>
            <span>Status</span><span />
          </div>
          {logs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              No mileage logged yet.
            </div>
          ) : logs.map(l => {
            const amount = l.miles * l.ratePerMile;
            const materialized = !!l.transactionId;
            return (
              <div key={l.id} style={{
                display: 'grid', gridTemplateColumns: 'var(--cols)',
                padding: '12px 22px', borderBottom: '1px solid var(--border)',
                gap: 12, alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{l.date}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{l.purpose}</div>
                  {l.notes && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{l.notes}</div>}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-strong)' }}>{l.miles.toFixed(1)}</div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>${l.ratePerMile.toFixed(2)}</div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>{fmt(amount)}</div>
                <div>
                  {materialized
                    ? <Link href={`/transactions?tx=${l.transactionId}`}><Pill tone="success">✓ Materialized</Pill></Link>
                    : <Pill tone="ghost">Log only</Pill>}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {!materialized && <Btn variant="outline" size="sm" onClick={() => materialize(l.id)} disabled={busy}>↳ Expense</Btn>}
                  <Btn variant="ghost" size="sm" onClick={() => remove(l.id)} disabled={busy}>✕</Btn>
                </div>
              </div>
            );
          })}
        </ResizableTableShell>
      </Card>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat-sub" style={{ marginTop: 8, color: color ?? undefined }}>{value}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};
