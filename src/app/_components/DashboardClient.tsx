'use client';
import Link from 'next/link';
import { Card, Counter, HexBackdrop, MerchantLogo, Pill, ProgressBar, Hex, fmt, fmtDate, linkBtn } from './atoms';

type Props = {
  data: {
    cash: number;
    range: { key: string; label: string; days: number };
    month: { income: number; spend: number; prevSpend: number; saved: number };
    trail: Array<{ m: string; income: number; spend: number }>;
    heatmap: Array<{ date: string; spend: number; income: number; net: number }>;
    lastTx: Array<{ id: string; date: string; merchant: string; amount: number; category: string; categoryColor: string | null; account: string; accountMask: string }>;
    upcomingSubs: Array<{ id: string; merchant: string; amount: number; next: string | null }>;
    stats: { subActive: number; recsCount: number; accountCount: number; monthLabel: string; txCount: number };
  };
};

export default function DashboardClient({ data }: Props) {
  const netCash = data.month.income + data.month.spend; // spend negative
  const hasData = data.lastTx.length > 0 || data.trail.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* HERO */}
      <div style={{
        position: 'relative', background: 'var(--bm-hero-bg)', color: 'var(--bm-hero-fg)',
        borderRadius: 'var(--r-md)', padding: '32px 36px 28px', overflow: 'hidden',
      }}>
        <HexBackdrop opacity={0.13} color="var(--accent)" size={72} />
        <div data-mobile-grid="hero" style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 32, alignItems: 'end' }}>
          <div>
            <div className="t-caption" style={{ color: 'var(--accent)', marginBottom: 8 }}>★ {data.range.label.toUpperCase()}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
              Cash available across {data.stats.accountCount} account{data.stats.accountCount === 1 ? '' : 's'}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 88, lineHeight: 0.9, letterSpacing: 'var(--tr-tight)', textTransform: 'uppercase' }}>
              <Counter value={data.cash} format={v => fmt(v, { cents: false })} />
            </div>
            {hasData ? (
              <div style={{ marginTop: 14, display: 'flex', gap: 18, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>Net ({data.range.label.toLowerCase()})</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: netCash >= 0 ? 'var(--success)' : 'var(--error)', fontWeight: 600 }}>
                  {netCash >= 0 ? '▲' : '▼'} <Counter value={Math.abs(netCash)} format={v => fmt(v, { cents: false })} />
                </span>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>vs. <span style={{ color: 'rgba(255,255,255,0.7)' }}>{fmt(Math.abs(data.month.prevSpend), { cents: false })}</span> spent prior {data.range.days}d</span>
              </div>
            ) : (
              <div style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                No transactions in this window. <Link href="/connect" style={{ color: 'var(--accent)', fontWeight: 600 }}>Connect an account or import a CSV →</Link>
              </div>
            )}
          </div>
          <HeroStat label="Money in"   value={data.month.income}        color="var(--success)"          sign="+" />
          <HeroStat label="Money out"  value={Math.abs(data.month.spend)} color="var(--accent)"         sign="−" />
          <HeroStat label="Net saved"  value={data.month.saved}         color="var(--prusa-pro-green)"   sign="+" />
        </div>
      </div>

      {/* ROW 1: trail + budget hex */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18 }}>
        <Card eyebrow={data.range.label} title="Income vs. spending"
              action={
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--fg-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 2, background: 'var(--success)' }} /> Income</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 2, background: 'var(--accent)' }} /> Spending</span>
                </div>
              }>
          <TrailChart data={data.trail} />
        </Card>

        <Card eyebrow="At a glance" title="Quick stats">
          <div style={{ display: 'grid', gap: 14 }}>
            <StatRow label="Active subscriptions" value={data.stats.subActive.toString()} href="/subscriptions" />
            <StatRow label="Open recommendations" value={data.stats.recsCount.toString()} href="/alerts" accent={data.stats.recsCount > 0} />
            <StatRow label="Connected accounts" value={data.stats.accountCount.toString()} href="/connect" />
            <StatRow label={`Transactions (${data.range.label.toLowerCase()})`} value={data.stats.txCount.toLocaleString()} href="/transactions" />
          </div>
        </Card>
      </div>

      {/* ROW 2: recent activity + upcoming subs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18 }}>
        <Card eyebrow="Latest" title="Recent activity"
              action={<Link href="/transactions" style={{ ...linkBtn, textDecoration: 'none' }}>ALL TRANSACTIONS →</Link>}
              padding={0}>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {data.lastTx.length === 0 ? (
              <div style={{ padding: 24, fontSize: 13, color: 'var(--fg-muted)', textAlign: 'center' }}>
                No transactions yet.
              </div>
            ) : data.lastTx.map(tx => <TxRow key={tx.id} tx={tx} />)}
          </div>
        </Card>

        <Card eyebrow="Upcoming" title="Recurring next 14 days"
              action={<Link href="/subscriptions" style={{ ...linkBtn, textDecoration: 'none' }}>ALL →</Link>}
              padding={0}>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {data.upcomingSubs.length === 0 ? (
              <div style={{ padding: 24, fontSize: 13, color: 'var(--fg-muted)', textAlign: 'center' }}>
                Nothing recurring this week.
              </div>
            ) : data.upcomingSubs.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderBottom: '1px solid var(--border)' }}>
                <MerchantLogo name={s.merchant} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.merchant}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{s.next ? fmtDate(s.next) : ' - '}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>{fmt(s.amount, { cents: false })}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ROW 3: daily heatmap (range-scoped) */}
      <Card eyebrow={data.range.label} title="Spending heatmap"
            action={<Link href="/transactions" style={{ ...linkBtn, textDecoration: 'none' }}>TRANSACTIONS →</Link>}>
        <Heatmap data={data.heatmap} />
      </Card>
    </div>
  );
}

function HeroStat({ label, value, color, sign }: { label: string; value: number; color: string; sign: string }) {
  return (
    <div style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 22 }}>
      <div className="t-caption" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 32, lineHeight: 1, color }}>
        {value > 0 ? sign : ''}<Counter value={value} format={v => fmt(v, { cents: false })} />
      </div>
    </div>
  );
}

function StatRow({ label, value, href, accent }: { label: string; value: string; href: string; accent?: boolean }) {
  return (
    <Link href={href} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
      background: 'var(--bg-subtle)', textDecoration: 'none', transition: 'var(--dur-fast)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16,
        color: accent ? 'var(--accent)' : 'var(--fg-strong)',
      }}>{value}</span>
    </Link>
  );
}

// Waterfall chart: each time bucket is a "candle" composed of a green segment
// for income going UP and a red segment for spend going DOWN. The candle
// starts at the prior bucket's cumulative net and ends at the new cumulative
// net. Together the candles trace the running balance over the window.
//
// For zero-flow buckets (no income, no spend) we still render a thin tick at
// the running line so the eye can keep its place.
function TrailChart({ data }: { data: Array<{ m: string; income: number; spend: number }> }) {
  const W = 600, H = 220;
  const pad = { l: 36, r: 12, t: 18, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  if (data.length === 0) {
    return <div style={{ height: H, display: 'grid', placeItems: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>No data yet.</div>;
  }

  // Walk the data, computing cumulative net + the income/spend extents of each candle.
  type Step = { i: number; m: string; income: number; spend: number; preCum: number; postCum: number; high: number; low: number };
  const steps: Step[] = [];
  let cum = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const pre = cum;
    const high = pre + d.income;     // top of green segment (gross income above prior)
    const low  = high - d.spend;     // bottom of red segment (after spend) = postCum
    steps.push({ i, m: d.m, income: d.income, spend: d.spend, preCum: pre, postCum: low, high, low });
    cum = low;
  }

  // Y-axis range - include zero AND the running min/max so the line is visible.
  let yMax = Math.max(0, ...steps.map(s => s.high));
  let yMin = Math.min(0, ...steps.map(s => s.low));
  // Pad 8% so candles don't hug the frame
  const yPad = Math.max(1, (yMax - yMin) * 0.08);
  yMax += yPad; yMin -= yPad;

  const px = (i: number) => pad.l + ((i + 0.5) / data.length) * innerW;
  const py = (v: number) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const candleWidth = Math.max(3, Math.min(28, (innerW / data.length) * 0.6));

  // Gridlines (horizontal) at zero and quartiles within the visible range
  const gridLines: number[] = [];
  const span = yMax - yMin;
  const niceStep = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const stepSize = Math.ceil(span / 4 / niceStep) * niceStep;
  for (let v = Math.ceil(yMin / stepSize) * stepSize; v < yMax; v += stepSize) gridLines.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {/* Horizontal gridlines + axis labels */}
      {gridLines.map(v => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)}
                stroke={Math.abs(v) < 0.001 ? 'var(--border-strong)' : 'var(--border)'}
                strokeDasharray={Math.abs(v) < 0.001 ? undefined : '2 4'} />
          <text x={pad.l - 6} y={py(v) + 3} textAnchor="end"
                fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">
            {v === 0 ? '$0' : fmtAxisCompact(v)}
          </text>
        </g>
      ))}

      {/* Step connectors - dashed line from each bucket's postCum to the next bucket's preCum */}
      {steps.slice(0, -1).map((s, i) => (
        <line key={`con-${i}`}
              x1={px(i) + candleWidth / 2}
              x2={px(i + 1) - candleWidth / 2}
              y1={py(s.postCum)}
              y2={py(s.postCum)}
              stroke="var(--border-strong)"
              strokeDasharray="2 3" />
      ))}

      {/* Candles */}
      {steps.map(s => {
        const x = px(s.i) - candleWidth / 2;
        // Green income segment: from preCum up to high
        const incomeY = py(s.high);
        const incomeH = Math.max(s.income > 0 ? 1 : 0, py(s.preCum) - incomeY);
        // Red spend segment: from high down to low
        const spendY = py(s.high);
        const spendH = Math.max(s.spend > 0 ? 1 : 0, py(s.low) - spendY);
        // No-activity bucket: render a tick on the running line so the eye tracks
        const flat = s.income === 0 && s.spend === 0;
        return (
          <g key={s.i}>
            {flat ? (
              <line x1={x} x2={x + candleWidth} y1={py(s.preCum)} y2={py(s.preCum)} stroke="var(--fg-subtle)" strokeWidth="1.5" />
            ) : (
              <>
                {s.income > 0 && (
                  <rect x={x} y={incomeY} width={candleWidth} height={incomeH} fill="var(--success)" opacity="0.92" rx="1">
                    <title>{`${s.m}\n+${fmt(s.income)} income\n−${fmt(s.spend)} spend\nnet ${s.postCum >= s.preCum ? '+' : '−'}${fmt(Math.abs(s.postCum - s.preCum))}`}</title>
                  </rect>
                )}
                {s.spend > 0 && (
                  <rect x={x} y={spendY} width={candleWidth} height={spendH} fill="var(--accent)" opacity="0.92" rx="1">
                    <title>{`${s.m}\n+${fmt(s.income)} income\n−${fmt(s.spend)} spend\nnet ${s.postCum >= s.preCum ? '+' : '−'}${fmt(Math.abs(s.postCum - s.preCum))}`}</title>
                  </rect>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* X-axis labels */}
      {steps.map((s, i) => (i % Math.max(1, Math.floor(steps.length / 10)) === 0 || i === steps.length - 1) && (
        <text key={i} x={px(i)} y={H - 6} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">{s.m}</text>
      ))}
    </svg>
  );
}

function fmtAxisCompact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function TxRow({ tx }: { tx: Props['data']['lastTx'][number] }) {
  const isIncome = tx.amount > 0;
  // Click anywhere on the row → open the global transaction modal. Relative
  // href so the current path (/, /accounts, etc.) is preserved.
  return (
    <Link href={`?tx=${tx.id}`} style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: 14,
      padding: '12px 22px', borderBottom: '1px solid var(--border)',
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    }}>
      <MerchantLogo name={tx.merchant} size={32} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.merchant}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', gap: 8 }}>
          <span>{fmtDate(tx.date)}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: tx.categoryColor || 'var(--gray-500)' }} />
            {tx.category}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{tx.accountMask || tx.account}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: isIncome ? 'var(--success)' : 'var(--fg-strong)' }}>
        {isIncome ? '+' : '−'}{fmt(Math.abs(tx.amount))}
      </div>
    </Link>
  );
}

type HeatDay = { date: string; spend: number; income: number; net: number };
function Heatmap({ data }: { data: HeatDay[] }) {
  if (data.length === 0) return <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No data.</div>;

  // Group days by YYYY-MM so each month becomes its own calendar block.
  const byMonth = new Map<string, HeatDay[]>();
  for (const d of data) {
    const k = d.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(d);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxAmt = Math.max(1, ...data.map(d => d.spend));

  // Layout: how many months per row depends on count. The container queries
  // below take care of resizing text, but we still pick a sane column count.
  // 3 per row for 9+ months gives each block enough width that day-number
  // text stays legible without dropping below ~8px.
  const perRow = months.length <= 2 ? months.length
               : months.length <= 4 ? 2
               : 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${perRow}, 1fr)`,
        gap: 18, alignItems: 'start',
      }}>
        {months.map(([key, days]) => (
          <MonthCalendar key={key} monthKey={key} days={days} maxAmt={maxAmt} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, fontSize: 9, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
        <span>Less</span>
        {[ 'rgba(125,125,125,0.18)','rgba(253,80,0,0.22)','rgba(253,80,0,0.45)','rgba(253,80,0,0.72)','var(--accent)' ].map(c =>
          <span key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
        )}
        <span>More</span>
      </div>
    </div>
  );
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function intensityColor(intensity: number): string {
  if (intensity <= 0) return 'rgba(125,125,125,0.10)';
  if (intensity < 0.20) return 'rgba(253,80,0,0.18)';
  if (intensity < 0.40) return 'rgba(253,80,0,0.34)';
  if (intensity < 0.60) return 'rgba(253,80,0,0.52)';
  if (intensity < 0.80) return 'rgba(253,80,0,0.72)';
  return 'var(--accent)';
}

function MonthCalendar({ monthKey, days, maxAmt }: {
  monthKey: string;                    // YYYY-MM
  days: HeatDay[];
  maxAmt: number;
}) {
  const [yr, mo] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(yr, mo - 1, 1));
  const monthEnd   = new Date(Date.UTC(yr, mo, 0));        // last day of the month
  const daysInMonth = monthEnd.getUTCDate();
  const startDow = monthStart.getUTCDay();                  // 0=Sun

  // Build a lookup of YYYY-MM-DD → day record. Days outside the window render dimmed.
  const byDay = new Map(days.map(d => [d.date.slice(0, 10), d]));
  const windowDays = new Set(days.map(d => d.date.slice(0, 10)));
  const totalForMonth = days.reduce((s, d) => s + d.spend, 0);

  type Cell = { day: number | null; iso: string; spend: number; income: number; net: number; inWindow: boolean };
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ day: null, iso: '', spend: 0, income: 0, net: 0, inWindow: false });
      continue;
    }
    const iso = `${monthKey}-${String(dayNum).padStart(2, '0')}`;
    const r = byDay.get(iso);
    cells.push({
      day: dayNum, iso,
      spend: r?.spend ?? 0, income: r?.income ?? 0, net: r?.net ?? 0,
      inWindow: windowDays.has(iso),
    });
  }
  const lastFilledRow = Math.floor((startDow + daysInMonth - 1) / 7);
  const visibleCells = cells.slice(0, (lastFilledRow + 1) * 7);

  // `container-type: inline-size` lets nested elements use `cqi` (container
  // inline size) units so font sizes scale with the actual rendered width.
  // At 12-month layout (4 per row) the block is ~270px → text downsizes; at
  // 30-day layout (2 per row) the block is ~700px → text grows up to the cap.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, containerType: 'inline-size' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 'clamp(10px, 4.5cqi, 14px)', fontWeight: 700, color: 'var(--fg-strong)' }}>
          {MONTH_LABELS[mo - 1]} <span style={{ color: 'var(--fg-subtle)', fontWeight: 400 }}>{yr}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(9px, 3.8cqi, 12px)', color: 'var(--fg-muted)' }}>
          {fmt(totalForMonth, { cents: false })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'clamp(2px, 1cqi, 4px)' }}>
        {DOW_LABELS.map((d, i) => (
          <div key={i} style={{ fontSize: 'clamp(7px, 2.5cqi, 10px)', color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)', textAlign: 'center', paddingBottom: 2 }}>
            {d}
          </div>
        ))}
        {visibleCells.map((cell, i) => {
          if (cell.day == null) {
            return <div key={i} style={{ aspectRatio: '1 / 1' }} />;
          }
          const intensity = cell.inWindow ? cell.spend / maxAmt : 0;
          const bg = cell.inWindow ? intensityColor(intensity) : 'rgba(125,125,125,0.04)';
          const hasActivity = cell.spend > 0 || cell.income > 0;
          const isHighContrast = intensity > 0.5;
          const netColor = cell.net > 0
            ? (isHighContrast ? '#bbf7c8' : 'var(--success)')
            : cell.net < 0
              ? (isHighContrast ? '#fff' : 'var(--fg-strong)')
              : 'var(--fg-subtle)';
          const title = cell.inWindow
            ? `${cell.iso}\n+${fmt(cell.income)} income\n−${fmt(cell.spend)} spend\nnet ${cell.net >= 0 ? '+' : '−'}${fmt(Math.abs(cell.net))}\n\nClick to view transactions →`
            : `${cell.iso} (outside range)`;

          // Cell content: net flow dominates the center, day number tucks in top-left.
          // Both font sizes are `cqi`-relative so they shrink in dense 12-month views.
          const inner = (
            <>
              <div style={{
                position: 'absolute',
                top: 'clamp(2px, 0.8cqi, 4px)', left: 'clamp(3px, 1.4cqi, 6px)',
                fontSize: 'clamp(6px, 2.5cqi, 10px)',
                fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: isHighContrast ? 'rgba(255,255,255,0.75)' : 'var(--fg-subtle)',
                lineHeight: 1,
              }}>
                {cell.day}
              </div>
              {hasActivity && cell.inWindow && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(7px, 4.2cqi, 14px)',
                  fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: netColor,
                  lineHeight: 1, letterSpacing: '-0.02em',
                  textShadow: isHighContrast ? '0 1px 2px rgba(0,0,0,0.25)' : 'none',
                  pointerEvents: 'none',                  // let clicks fall through to the parent <Link>
                }}>
                  {cell.net >= 0 ? '+' : '−'}{fmtCompact(Math.abs(cell.net))}
                </div>
              )}
            </>
          );

          const baseStyle: React.CSSProperties = {
            aspectRatio: '1 / 1',
            background: bg,
            borderRadius: 4,
            position: 'relative',
            opacity: cell.inWindow ? 1 : 0.4,
            cursor: cell.inWindow ? 'pointer' : 'default',
            border: '1px solid transparent',
            transition: 'border-color var(--dur-fast), transform var(--dur-fast)',
          };

          if (!cell.inWindow) {
            return <div key={i} title={title} style={baseStyle}>{inner}</div>;
          }
          return (
            <Link
              key={i}
              href={`/transactions?date=${cell.iso}`}
              title={title}
              style={{ ...baseStyle, textDecoration: 'none' }}
              className="cal-cell"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Compact dollar formatter for tiny calendar cell labels: $1.2k, $34, $890
function fmtCompact(n: number): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return '$' + Math.round(n);
}
