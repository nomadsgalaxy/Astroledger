'use client';
import { useState } from 'react';
import { Card, Pill, SectionHeader, fmt } from './atoms';

type Flow = { name: string; amount: number; color: string };
type DailyEntry = { d: number; in: number; out: number };
type TransferRoute = {
  src: { name: string; mask: string | null };
  dst: { name: string; mask: string | null };
  total: number;
  count: number;
};

type Props = {
  rangeLabel: string;
  rangeDays: number;
  totalIn: number; totalOut: number; net: number; savingsRate: number;
  prevTotalOut: number;
  inflows: Flow[]; outflows: Flow[];
  daily: DailyEntry[];
  transferRoutes: TransferRoute[];
  transferTotalAbs: number;
};

export default function CashflowClient(props: Props) {
  const [view, setView] = useState<'sankey' | 'calendar' | 'timeline'>('sankey');
  const { rangeLabel, rangeDays, totalIn, totalOut, net, savingsRate, prevTotalOut, inflows, outflows, daily, transferRoutes, transferTotalAbs } = props;
  const hasData = inflows.length > 0 || outflows.length > 0;
  const today = daily.length; // last day in window = "today"

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${rangeLabel} · In ↔ Out`}
        title="Cashflow"
        subtitle="Where money entered, where it went in the selected window. Every flow auto-categorized."
        right={
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)' }}>
            {([['sankey', 'Sankey'], ['calendar', 'Strip'], ['timeline', 'Timeline']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setView(id)} style={{
                fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
                letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
                padding: '6px 14px', borderRadius: 'var(--r-xs)', border: 0, cursor: 'pointer',
                background: view === id ? 'var(--bg-elevated)' : 'transparent',
                color: view === id ? 'var(--fg-strong)' : 'var(--fg-muted)',
                boxShadow: view === id ? 'var(--shadow-sm)' : 'none',
              }}>{label}</button>
            ))}
          </div>
        }
      />

      <div data-mobile-grid="stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Money in" value={fmt(totalIn, { cents: false })} color="var(--success)" sign="+" /></Card>
        <Card padding={20}><BigStat label="Money out" value={fmt(totalOut, { cents: false })} color="var(--accent)" sign="−" /></Card>
        <Card padding={20}><BigStat label="Net" value={fmt(Math.abs(net), { cents: false })} color={net >= 0 ? 'var(--success)' : 'var(--error)'} sign={net >= 0 ? '+' : '−'} /></Card>
        <Card padding={20}><BigStat label="Savings rate" value={`${savingsRate}%`} /></Card>
      </div>

      <Card padding={0} style={{ overflow: 'visible' }}>
        <div className="m3-chart-header" style={{ padding: '16px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="t-caption">
              {view === 'sankey' ? 'Income → Tags' : view === 'calendar' ? 'Daily totals strip' : 'Daily net flow'}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15, color: 'var(--fg-strong)', marginTop: 2 }}>
              {view === 'sankey' && 'Where every dollar went'}
              {view === 'calendar' && `Day strip · ${rangeLabel}`}
              {view === 'timeline' && 'Running balance'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            {fmt(totalIn, { cents: false })} in · {fmt(totalOut, { cents: false })} out · vs {fmt(prevTotalOut, { cents: false })} prior {rangeDays}d
          </div>
        </div>
        <div style={{ padding: '12px 22px 22px' }}>
          {!hasData ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--fg-muted)' }}>
              No activity in this window. <a href="/connect" style={{ color: 'var(--accent)' }}>Connect an account →</a>
            </div>
          ) : view === 'sankey' ? (
            <>
              <div className="m3-desktop-only">
                <Sankey inflows={inflows} outflows={outflows} />
              </div>
              <div className="m3-mobile-only">
                <MobileFlowList inflows={inflows} outflows={outflows} />
              </div>
            </>
          ) : view === 'calendar' ? (
            <DayStripView daily={daily} />
          ) : (
            <TimelineView daily={daily} today={today} />
          )}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card eyebrow="Money in" title="Sources"
              action={<Pill tone="success">+{fmt(totalIn, { cents: false })}</Pill>} padding={0}>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {inflows.length === 0 ? <Empty /> : inflows.map(f => <FlowRow key={f.name} flow={f} total={totalIn} positive />)}
          </div>
        </Card>
        <Card eyebrow="Money out" title="Tags"
              action={<Pill tone="error">−{fmt(totalOut, { cents: false })}</Pill>} padding={0}>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {outflows.length === 0 ? <Empty /> : outflows.slice(0, 6).map(f => <FlowRow key={f.name} flow={f} total={totalOut} />)}
          </div>
        </Card>
      </div>

      {transferRoutes.length > 0 && (
        <Card eyebrow="Internal moves" title="Transfers"
              action={<Pill tone="info">{fmt(transferTotalAbs, { cents: false })} across {transferRoutes.reduce((s, r) => s + r.count, 0)} move{transferRoutes.reduce((s, r) => s + r.count, 0) === 1 ? '' : 's'}</Pill>} padding={0}>
          <div style={{ padding: '10px 22px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
            Money flowing between your own accounts in this window. Excluded from income / spending totals
            above - these are the same money, not new earnings or expenses.
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {transferRoutes.map(r => (
              <TransferRouteRow key={`${r.src.name}->${r.dst.name}`} route={r} maxTotal={transferRoutes[0].total} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TransferRouteRow({ route, maxTotal }: { route: TransferRoute; maxTotal: number }) {
  const pct = maxTotal > 0 ? (route.total / maxTotal) * 100 : 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 24px 1fr auto 110px',
      alignItems: 'center', gap: 12,
      padding: '12px 22px', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {route.src.name}
        </div>
        {route.src.mask && (
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>· {route.src.mask}</div>
        )}
      </div>
      <div style={{ textAlign: 'center', fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>→</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {route.dst.name}
        </div>
        {route.dst.mask && (
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>· {route.dst.mask}</div>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmt(route.total, { cents: false })}
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', fontWeight: 400 }}>
          {route.count} move{route.count === 1 ? '' : 's'}
        </div>
      </div>
      <div>
        <div style={{ height: 4, background: 'var(--bg-panel)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 600ms var(--ease-out)' }} />
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ padding: 24, color: 'var(--fg-muted)', textAlign: 'center', fontSize: 13 }}>No data yet.</div>;
}

function BigStat({ label, value, color, sign }: { label: string; value: string; color?: string; sign?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat" style={{ marginTop: 10, color: color ?? undefined }}>
        {sign ?? ''}{value}
      </div>
    </div>
  );
}

function FlowRow({ flow, total, positive }: { flow: Flow; total: number; positive?: boolean }) {
  const pct = total > 0 ? (flow.amount / total) * 100 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto 80px', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: flow.color }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{flow.name}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: positive ? 'var(--success)' : 'var(--fg-strong)' }}>
        {positive ? '+' : '−'}{fmt(flow.amount, { cents: false })}
      </div>
      <div>
        <div style={{ height: 4, background: 'var(--bg-panel)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: flow.color, transition: 'width 600ms var(--ease-out)' }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)', marginTop: 3, textAlign: 'right' }}>{pct.toFixed(1)}%</div>
      </div>
    </div>
  );
}

// ===== Mobile fallback for the Sankey =====
// At narrow widths the Sankey just can't render legibly even with the HTML
// label overlay - the chart middle gets crushed and the gutters fight the
// labels for space. Below 600px we show a two-section list instead:
// inflows ranked by amount with a horizontal bar fill, then outflows in the
// same form. Preserves the "where the money came from / where it went"
// mental model without trying to map ribbons across a 320px viewport.
function MobileFlowList({ inflows, outflows }: { inflows: Flow[]; outflows: Flow[] }) {
  const totalIn = inflows.reduce((s, f) => s + f.amount, 0);
  const totalOut = outflows.reduce((s, f) => s + f.amount, 0);
  const Section = ({ title, rows, total, sign, accentVar }: {
    title: string; rows: Flow[]; total: number; sign: '+' | '−'; accentVar: string;
  }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.12em', color: 'var(--fg-muted)',
      }}>
        <span>{title}</span>
        <span style={{ color: `var(${accentVar})`, fontFamily: 'var(--font-mono)' }}>
          {sign}{fmt(total, { cents: false })}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '6px 0' }}>None in this window.</div>
        ) : rows.map(f => {
          const pct = total > 0 ? Math.round((f.amount / total) * 100) : 0;
          return (
            <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  minWidth: 0, flex: 1,
                }}>{f.name}</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: 'var(--fg-strong)', flexShrink: 0,
                }}>{sign}{fmt(f.amount, { cents: false })} <span style={{ color: 'var(--fg-muted)' }}>· {pct}%</span></span>
              </div>
              <div style={{ height: 4, background: 'var(--bg-panel)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: f.color, transition: 'width 400ms var(--ease-out)' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Section title="Money in · Sources" rows={inflows} total={totalIn} sign="+" accentVar="--success" />
      <Section title="Money out · Tags" rows={outflows} total={totalOut} sign="−" accentVar="--accent" />
    </div>
  );
}

// ===== Sankey =====
// Layout split: SVG handles the bars + ribbons (geometry - scales with the
// viewBox), HTML handles every text label (font sizes stay at honest CSS
// pixels regardless of how wide the container is). Without this split the
// SVG viewBox of 1300 units scales down to ~28% on phones and labels render
// at ~3–4px, unreadable. Labels for sub-3% flows are suppressed so tall
// stacks of tiny categories don't visually collide.
function Sankey({ inflows, outflows }: { inflows: Flow[]; outflows: Flow[] }) {
  // viewBox dimensions - chosen so the gutters reserved for labels are wide
  // enough to fit both a category name AND its mono-formatted "$6,430 · 75%"
  // value at the smallest container width we care about (~311px inside a
  // mobile card): 31% of 311 ≈ 96px after the inner padding, comfortable for
  // ~13 monospace characters.
  const W = 1000, H = 420;
  const padL = 310, padR = 310, padT = 28, padB = 28;
  const leftX = padL, rightX = W - padR, colW = 18;
  const totalIn = inflows.reduce((s, f) => s + f.amount, 0);
  const totalOut = outflows.reduce((s, f) => s + f.amount, 0);
  const total = Math.max(totalIn, totalOut, 1);
  const usableH = H - padT - padB;
  const gap = 4;

  const inBars: Array<Flow & { y: number; h: number }> = [];
  let y = padT;
  inflows.forEach(f => {
    const h = (f.amount / total) * (usableH - Math.max(0, inflows.length - 1) * gap);
    inBars.push({ ...f, y, h });
    y += h + gap;
  });

  const outBars: Array<Flow & { y: number; h: number }> = [];
  let y2 = padT;
  outflows.forEach(f => {
    const h = (f.amount / total) * (usableH - Math.max(0, outflows.length - 1) * gap);
    outBars.push({ ...f, y: y2, h });
    y2 += h + gap;
  });

  // Proportional ribbons between each inflow and each outflow
  const inPix = inBars.map(() => 0);
  const outPix = outBars.map(() => 0);
  const flows: Array<{ y1Top: number; y1Bot: number; y2Top: number; y2Bot: number; color: string; inn: Flow; out: Flow }> = [];
  outflows.forEach((out, oi) => {
    inflows.forEach((inn, ii) => {
      if (totalIn === 0) return;
      const ratio = inn.amount / totalIn;
      const ribbonH = (out.amount / total) * (usableH - Math.max(0, outflows.length - 1) * gap) * ratio;
      const y1 = inBars[ii].y + inPix[ii];
      const y3 = outBars[oi].y + outPix[oi];
      flows.push({ y1Top: y1, y1Bot: y1 + ribbonH, y2Top: y3, y2Bot: y3 + ribbonH, color: out.color, inn, out });
      inPix[ii] += ribbonH;
      outPix[oi] += ribbonH;
    });
  });

  const [hover, setHover] = useState<{ inn?: string; out?: string; amount?: number } | null>(null);
  const ribbonPath = (f: { y1Top: number; y1Bot: number; y2Top: number; y2Bot: number }) => {
    const cx = (leftX + colW + rightX - colW) / 2;
    return `M ${leftX + colW} ${f.y1Top} C ${cx} ${f.y1Top}, ${cx} ${f.y2Top}, ${rightX - colW} ${f.y2Top} L ${rightX - colW} ${f.y2Bot} C ${cx} ${f.y2Bot}, ${cx} ${f.y1Bot}, ${leftX + colW} ${f.y1Bot} Z`;
  };

  // Suppress labels for flows under 3% of total - keeps tiny categories
  // from colliding into illegible stacks.
  const labelThreshold = 0.03;
  // Percentages used for HTML overlay positioning (relative to the SVG box,
  // which fills 100% of the wrapper).
  const leftGutterPct = (leftX / W) * 100;        // 31%
  const rightGutterStart = (rightX / W) * 100;    // 69%

  // Label collision avoidance: each label is two lines of text (~30px CSS)
  // and gets centered on its bar. When two adjacent bars have similar small
  // percentages (e.g. 5% / 5% / 4%) their centers cluster within ~24px,
  // overlapping the labels by 2-8px. Run a two-pass sweep that nudges
  // labels apart while keeping the ordering and staying as close as
  // possible to the ideal (bar-center) position. Working in percentage of
  // chart height so the same constant scales reasonably across viewports
  // (7% ≈ 30px at 420px desktop, ≈ 10px at 140px mobile - the latter is
  // handled by the 3% threshold above hiding small bars anyway).
  const minGapPct = 7;
  function placeLabels(bars: Array<Flow & { y: number; h: number }>): Map<string, number> {
    const visible = bars.filter(b => b.amount / total >= labelThreshold);
    const items = visible.map(b => ({ name: b.name, pct: ((b.y + b.h / 2) / H) * 100 }));
    items.sort((a, b) => a.pct - b.pct);
    for (let i = 1; i < items.length; i++) {
      if (items[i].pct - items[i - 1].pct < minGapPct) {
        items[i].pct = items[i - 1].pct + minGapPct;
      }
    }
    if (items.length && items[items.length - 1].pct > 100) {
      items[items.length - 1].pct = 100;
      for (let i = items.length - 2; i >= 0; i--) {
        if (items[i + 1].pct - items[i].pct < minGapPct) {
          items[i].pct = items[i + 1].pct - minGapPct;
        }
      }
    }
    if (items.length && items[0].pct < 0) {
      items[0].pct = 0;
      for (let i = 1; i < items.length; i++) {
        if (items[i].pct - items[i - 1].pct < minGapPct) {
          items[i].pct = items[i - 1].pct + minGapPct;
        }
      }
    }
    return new Map(items.map(it => [it.name, it.pct]));
  }
  const inLabelPct = placeLabels(inBars);
  const outLabelPct = placeLabels(outBars);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Header row - moved out of SVG so it sits at honest CSS pixel size */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: 'var(--font-product)', fontSize: 11, fontWeight: 700,
        letterSpacing: '0.12em', color: 'var(--fg-muted)',
      }}>
        <span>INCOME · <span style={{ color: 'var(--success)' }}>{fmt(totalIn, { cents: false })}</span></span>
        <span>SPENDING · <span style={{ color: 'var(--accent)' }}>{fmt(totalOut, { cents: false })}</span></span>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet">
          {flows.map((f, i) => (
            <path key={i} d={ribbonPath(f)}
              fill={f.color}
              opacity={hover === null ? 0.35 : (hover.inn === f.inn.name || hover.out === f.out.name) ? 0.7 : 0.08}
              onMouseEnter={() => setHover({ inn: f.inn.name, out: f.out.name, amount: f.inn.amount * (f.out.amount / total) })}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'opacity var(--dur-fast)' }} />
          ))}
          {inBars.map(b => (
            <rect key={b.name} x={leftX} y={b.y} width={colW} height={b.h} fill={b.color}
                  onMouseEnter={() => setHover({ inn: b.name })}
                  onMouseLeave={() => setHover(null)} />
          ))}
          {outBars.map(b => (
            <rect key={b.name} x={rightX - colW} y={b.y} width={colW} height={b.h} fill={b.color}
                  onMouseEnter={() => setHover({ out: b.name })}
                  onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {/* Inflow labels - anchored to the left gutter, vertically positioned
            via the collision-resolved map (falls back to bar center if a flow
            was excluded by the threshold, though that branch returns null). */}
        {inBars.map(b => {
          const topPct = inLabelPct.get(b.name);
          if (topPct === undefined) return null;
          return (
            <div key={b.name} style={{
              position: 'absolute',
              left: 0,
              width: `calc(${leftGutterPct}% - 10px)`,
              top: `${topPct}%`,
              transform: 'translateY(-50%)',
              textAlign: 'right',
              lineHeight: 1.2,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}>
              <div style={{
                fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
                color: 'var(--fg-strong)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{b.name}</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11,
                color: 'var(--success)', whiteSpace: 'nowrap',
              }}>+{fmt(b.amount, { cents: false })}</div>
            </div>
          );
        })}
        {/* Outflow labels - anchored to the right gutter, same collision map */}
        {outBars.map(b => {
          const topPct = outLabelPct.get(b.name);
          if (topPct === undefined) return null;
          return (
            <div key={b.name} style={{
              position: 'absolute',
              left: `calc(${rightGutterStart}% + 10px)`,
              right: 0,
              top: `${topPct}%`,
              transform: 'translateY(-50%)',
              textAlign: 'left',
              lineHeight: 1.2,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}>
              <div style={{
                fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
                color: 'var(--fg-strong)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{b.name}</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11,
                color: 'var(--fg-muted)', whiteSpace: 'nowrap',
              }}>{fmt(b.amount, { cents: false })} · {Math.round(b.amount / total * 100)}%</div>
            </div>
          );
        })}
        {hover && hover.inn && hover.out && (
          <div style={{
            position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)',
            background: 'var(--bg-inverse)', color: 'var(--fg-on-dark)',
            padding: '8px 14px', borderRadius: 'var(--r-sm)', fontSize: 12, fontFamily: 'var(--font-mono)',
            pointerEvents: 'none', boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap',
          }}>
            <strong style={{ color: 'var(--success)' }}>{hover.inn}</strong>{' → '}
            <strong>{hover.out}</strong>{' · '}{fmt(hover.amount ?? 0, { cents: false })}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Day strip (range-windowed grid of N days) =====
function DayStripView({ daily }: { daily: DailyEntry[] }) {
  const maxOut = Math.max(1, ...daily.map(d => d.out));
  // Choose column count based on window size for legibility
  const cols = daily.length <= 31 ? 7 : daily.length <= 100 ? 10 : 14;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
      {daily.map((day, i) => {
        const intensity = day.out / maxOut;
        const dayLabel = i + 1;
        const isLast = i === daily.length - 1;
        return (
          <div key={i} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            padding: cols >= 10 ? '6px 8px' : '8px 10px',
            minHeight: cols >= 14 ? 56 : cols >= 10 ? 64 : 80,
            background: `linear-gradient(180deg, var(--bg-elevated) 0%, rgba(253,80,0,${(intensity * 0.18).toFixed(3)}) 100%)`,
            outline: isLast ? '2px solid var(--accent)' : 'none',
            outlineOffset: isLast ? -2 : 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: cols >= 14 ? 9 : 11, color: isLast ? 'var(--accent)' : 'var(--fg-muted)' }}>{dayLabel}</span>
              {day.in > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--success)' }} />}
            </div>
            {day.out > 0 && cols < 14 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: cols >= 10 ? 10 : 11, fontWeight: 600, color: 'var(--fg-strong)' }}>
                −{fmt(day.out, { cents: false })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== Timeline =====
function TimelineView({ daily, today }: { daily: DailyEntry[]; today: number }) {
  // Cumulative net from day 1 (relative)
  let bal = 0;
  const points = daily.map(d => {
    bal += (d.in - d.out);
    return { d: d.d, bal, future: d.d > today };
  });

  const W = 1100, H = 320;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const min = Math.min(0, ...points.map(p => p.bal)) * 1.05;
  const max = Math.max(0, ...points.map(p => p.bal)) * 1.05 || 1;
  const px = (i: number) => padL + (i / Math.max(1, points.length - 1)) * innerW;
  const py = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const past = points.filter(p => !p.future);
  const future = points.filter(p => p.future);
  const pathPast = past.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.d - 1)} ${py(p.bal)}`).join(' ');
  const pathFuture = future.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.d - 1)} ${py(p.bal)}`).join(' ');
  const areaPath = pathPast + ` L ${px(today - 1)} ${py(min)} L ${px(0)} ${py(min)} Z`;
  const todayPoint = points[today - 1] ?? points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {[0.25, 0.5, 0.75, 1].map(g => (
        <line key={g} x1={padL} x2={W - padR} y1={py(min + (max - min) * g)} y2={py(min + (max - min) * g)}
              stroke="var(--border)" strokeDasharray="2 4" />
      ))}
      <path d={areaPath} fill="var(--accent)" opacity="0.10" />
      <path d={pathPast} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      <path d={pathFuture} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
      <line x1={px(today - 1)} x2={px(today - 1)} y1={padT} y2={H - padB}
            stroke="var(--fg-strong)" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
      <circle cx={px(today - 1)} cy={py(todayPoint.bal)} r="5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />
      <text x={px(today - 1) + 8} y={padT + 12} fontFamily="var(--font-mono)" fontSize="11" fontWeight="600" fill="var(--fg-strong)">
        TODAY · {fmt(todayPoint.bal, { cents: false, sign: true })}
      </text>
      {[1, 8, 15, 22, 29].filter(d => d <= points.length).map(d => (
        <text key={d} x={px(d - 1)} y={H - 10} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">Day {d}</text>
      ))}
      <text x={padL - 8} y={py(max)} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(max, { cents: false })}</text>
      <text x={padL - 8} y={py(min) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(min, { cents: false })}</text>
    </svg>
  );
}
