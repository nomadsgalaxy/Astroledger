'use client';
import { useState } from 'react';
import { Card, Hex, HexBackdrop, Counter, ProgressBar, SectionHeader, Btn, fmt } from './atoms';

type Row = { id: string; name: string; icon: string; cap: number; spent: number; color: string | null };

function status(r: Row): 'under' | 'approaching' | 'over' {
  if (r.cap === 0) return 'under';
  const ratio = r.spent / r.cap;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.85) return 'approaching';
  return 'under';
}

const STATUS_COLORS = {
  under: 'var(--mode-simple)',
  approaching: 'var(--mode-advanced)',
  over: 'var(--mode-expert)',
};

const STATUS_LABELS = {
  under: 'On track',
  approaching: 'Approaching cap',
  over: 'Over budget',
};

export default function BudgetsClient({ rows, rangeLabel, rangeDays }: {
  rows: Row[]; rangeLabel: string; rangeDays: number;
}) {
  const [view, setView] = useState<'hex' | 'bar'>('hex');
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find(r => r.id === selectedId) ?? null;

  const totalCap = rows.reduce((s, r) => s + r.cap, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const remaining = Math.max(0, totalCap - totalSpent);
  // The cap is already pro-rated to the window, so "expected" = totalCap at end of window.
  // Use elapsed-fraction = 1 since the window is the budget period.
  const expectedSpent = totalCap;
  // If no caps are set, "on track" is meaningless. Check per-row overages
  // so we don't lie about being on track while individual envelopes are over.
  const anyOver = rows.some(r => r.cap > 0 && r.spent > r.cap);
  const onTrack = totalCap > 0 ? (totalSpent <= expectedSpent && !anyOver) : !anyOver;
  const statusLabel = totalCap === 0 && !anyOver ? 'No caps set' : onTrack ? 'On track' : anyOver ? 'Over budget' : 'Pace warning';
  const statusColor = onTrack ? 'var(--mode-simple)' : anyOver ? 'var(--mode-expert)' : 'var(--mode-advanced)';

  if (rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <SectionHeader eyebrow={rangeLabel} title="Budgets"
          subtitle="A health hex for every category. Caps are pro-rated to the selected window. Green is healthy, yellow is approaching, red is over." />
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No budgets yet</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Import transactions first, then set monthly caps per category.
            </div>
            <Btn variant="primary">Import transactions</Btn>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${rows.length} envelopes · ${rangeLabel}`}
        title="Budgets"
        subtitle="A health hex for every category. Caps are pro-rated to the selected window. Green is healthy, yellow is approaching, red is over."
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="outline" size="md" icon="↺">Reset window</Btn>
            <Btn variant="primary" size="md" icon="+">New envelope</Btn>
          </div>
        }
      />

      {/* Hero summary */}
      <div style={{
        background: 'var(--bm-hero-bg)', color: 'var(--bm-hero-fg)',
        borderRadius: 'var(--r-md)', padding: '26px 30px',
        position: 'relative', overflow: 'hidden',
        display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 24,
      }}>
        <HexBackdrop opacity={0.10} color={onTrack ? 'var(--success)' : 'var(--accent)'} size={56} />
        <div style={{ position: 'relative' }}>
          <div className="t-caption" style={{ color: 'rgba(255,255,255,0.5)' }}>Cap ({rangeLabel.toLowerCase()})</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: 'var(--tr-tight)', textTransform: 'uppercase', marginTop: 6 }}>
            <Counter value={totalCap} format={v => fmt(v, { cents: false })} />
          </div>
          <div style={{ marginTop: 8, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totalCap ? Math.min(100, (totalSpent / totalCap) * 100) : 0}%`, background: onTrack ? 'var(--success)' : 'var(--accent)', transition: 'width 800ms var(--ease-out)' }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.6)' }}>
            {rangeDays}-day window · Pro-rated from monthly caps
          </div>
        </div>
        <DarkStat label="Spent" value={fmt(totalSpent, { cents: false })} sub={totalCap ? `${Math.round(totalSpent / totalCap * 100)}% of cap` : ' - '} />
        <DarkStat label="Remaining" value={<span style={{ color: 'var(--success)' }}>{fmt(remaining, { cents: false })}</span>} sub={totalCap ? `${Math.round(remaining / totalCap * 100)}% left` : ' - '} />
        <DarkStat label="Status" value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Hex size={26} color={statusColor} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 22, fontWeight: 700 }}>{statusLabel}</span>
          </span>
        } sub={onTrack && totalCap > 0 ? `Under by ${fmt(expectedSpent - totalSpent, { cents: false })}` :
              anyOver ? `${rows.filter(r => r.cap > 0 && r.spent > r.cap).length} envelope${rows.filter(r => r.cap > 0 && r.spent > r.cap).length === 1 ? '' : 's'} over` :
              totalCap === 0 ? 'Set a cap to enable pace tracking' : 'Slow down spending'} />
      </div>

      {/* Legend + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 12 }}>
          <LegendDot color="var(--mode-simple)" label="Healthy (< 85%)" />
          <LegendDot color="var(--mode-advanced)" label="Approaching (85–100%)" />
          <LegendDot color="var(--mode-expert)" label="Over budget" />
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)' }}>
          {([['hex', 'Hexagons'], ['bar', 'Bars']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{
              fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
              letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
              padding: '6px 14px', borderRadius: 'var(--r-xs)', border: 0, cursor: 'pointer',
              background: view === id ? 'var(--bg-elevated)' : 'transparent',
              color: view === id ? 'var(--fg-strong)' : 'var(--fg-muted)',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Grid + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18 }}>
        <Card padding={view === 'hex' ? 28 : 0}>
          {view === 'hex' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 24 }}>
              {rows.map(r => <BudgetHexCard key={r.id} row={r} selected={selectedId === r.id} onClick={() => setSelectedId(r.id)} />)}
            </div>
          ) : (
            <div>{rows.map(r => <BarRow key={r.id} row={r} selected={selectedId === r.id} onClick={() => setSelectedId(r.id)} />)}</div>
          )}
        </Card>

        {selected && <BudgetDetail row={selected} windowDays={rangeDays} />}
      </div>
    </div>
  );
}

function DarkStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', borderLeft: '1px solid rgba(255,255,255,0.12)', paddingLeft: 20 }}>
      <div className="t-caption" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</div>
      <div className="t-stat" style={{ marginTop: 10, color: '#fff' }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fg-muted)' }}>
      <Hex size={14} color={color} />{label}
    </span>
  );
}

function BudgetHexCard({ row, selected, onClick }: { row: Row; selected: boolean; onClick: () => void }) {
  const s = status(row);
  const color = STATUS_COLORS[s];
  const pct = row.cap > 0 ? Math.round((row.spent / row.cap) * 100) : 0;
  const overage = Math.max(0, row.spent - row.cap);
  const fillPct = Math.min(pct, 100);
  return (
    <div onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '16px 6px', borderRadius: 'var(--r-md)', cursor: 'pointer',
      border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
      background: selected ? 'var(--bg-subtle)' : 'transparent',
      transition: 'var(--dur-fast)',
    }}>
      <div style={{ position: 'relative', width: 110, height: 126 }}>
        <Hex size={110} color={`color-mix(in oklab, ${color} 15%, var(--bg-elevated))`} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fillPct}%`, overflow: 'hidden' }}>
          <Hex size={110} color={color} style={{ position: 'absolute', left: 0, bottom: 0, height: 126 }} />
        </div>
        <svg viewBox="0 0 100 115" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <polygon points="50,2 98,28.75 98,86.25 50,113 2,86.25 2,28.75" fill="none" stroke={color} strokeWidth="2" opacity="0.7" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 26 }}>{row.icon}</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
            color: s === 'over' ? '#fff' : 'var(--fg-strong)', marginTop: 2,
            textShadow: s === 'over' ? '0 1px 1px rgba(0,0,0,0.4)' : 'none',
          }}>{row.cap ? `${pct}%` : ' - '}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)', textAlign: 'center' }}>{row.name}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
        {fmt(row.spent, { cents: false })} / {row.cap ? fmt(row.cap, { cents: false }) : ' - '}
      </div>
      {overage > 0 && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--error)', fontWeight: 600 }}>
          OVER BY {fmt(overage, { cents: false })}
        </div>
      )}
    </div>
  );
}

function BarRow({ row, selected, onClick }: { row: Row; selected: boolean; onClick: () => void }) {
  const s = status(row);
  const pct = row.cap > 0 ? Math.round((row.spent / row.cap) * 100) : 0;
  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: '26px 1fr 100px 80px 1fr 80px',
      gap: 14, alignItems: 'center', padding: '12px 22px',
      borderBottom: '1px solid var(--border)', cursor: 'pointer',
      background: selected ? 'var(--bg-subtle)' : 'transparent', transition: 'var(--dur-fast)',
    }}>
      <Hex size={22} color={STATUS_COLORS[s]} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{row.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{row.name}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)' }}>
        {fmt(row.spent, { cents: false })}
        <span style={{ color: 'var(--fg-subtle)' }}> / {row.cap ? fmt(row.cap, { cents: false }) : ' - '}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: s === 'over' ? 'var(--error)' : 'var(--fg-strong)' }}>
        {row.cap ? `${pct}%` : ' - '}
      </div>
      {row.cap > 0 ? <ProgressBar value={row.spent} max={row.cap} height={6} /> : <div />}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right',
        color: s === 'over' ? 'var(--error)' : 'var(--fg-muted)' }}>
        {row.cap === 0 ? 'no cap' : s === 'over' ? `+${fmt(row.spent - row.cap, { cents: false })}` : `${fmt(row.cap - row.spent, { cents: false })} left`}
      </div>
    </div>
  );
}

function BudgetDetail({ row, windowDays }: { row: Row; windowDays: number }) {
  const s = status(row);
  const pct = row.cap > 0 ? Math.round((row.spent / row.cap) * 100) : 0;
  const dailyAvg = row.spent / Math.max(1, windowDays);
  const projected = dailyAvg * 30; // monthly projection
  const remaining = row.cap - row.spent;
  return (
    <Card padding={0}>
      <div style={{
        padding: 22, background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Hex size={48} color={STATUS_COLORS[s]}>
          <span style={{ fontSize: 22 }}>{row.icon}</span>
        </Hex>
        <div style={{ flex: 1 }}>
          <div className="t-caption" style={{ marginBottom: 2 }}>{STATUS_LABELS[s]}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>{row.name}</div>
        </div>
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 28, color: 'var(--fg-strong)' }}>
              <Counter value={row.spent} format={v => fmt(v, { cents: false })} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>of {row.cap ? fmt(row.cap, { cents: false }) : ' - no cap'}</div>
          </div>
          {row.cap > 0 && <div style={{ marginTop: 8 }}><ProgressBar value={row.spent} max={row.cap} height={8} /></div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MiniStat label="Daily avg" value={fmt(dailyAvg)} />
          <MiniStat label="Projected / mo" value={fmt(projected, { cents: false })} />
          <MiniStat label="Remaining" value={s === 'over' || row.cap === 0 ? ' - ' : fmt(remaining, { cents: false })} />
          <MiniStat label="Window" value={`${windowDays}d`} note="Cap is pro-rated" />
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
          <Btn variant="outline" size="sm">{row.cap === 0 ? 'Set cap' : 'Adjust cap'}</Btn>
          <Btn variant="outline" size="sm">Roll over</Btn>
          <Btn variant="ghost" size="sm">Archive</Btn>
        </div>
      </div>
    </Card>
  );
}

function MiniStat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-sm)' }}>
      <div className="t-caption" style={{ fontSize: 9, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16, color: 'var(--fg-strong)' }}>{value}</div>
      {note && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>{note}</div>}
    </div>
  );
}
