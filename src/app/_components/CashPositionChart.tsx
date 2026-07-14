'use client';
import { useId, useMemo, useState } from 'react';
import { fmt } from './atoms';

type Pt = {
  dateISO: string;
  balance: number;
  inflow: number;
  outflow: number;
  transferIn: number;
  transferOut: number;
  transferNeutral: number;
  notes: string[];
};

// Daily cash-position chart. Visual language:
//   • Smooth area + line over a horizontal gridded plot
//   • Today vertical guide on the left edge
//   • Weekend bands subtly tinted so weekly rhythm is legible
//   • Event glyphs along the line: ▲ inflow · ▼ outflow · ◆ transfer
//   • Low-water marker (warning ring) and biggest-out marker (red dotted line)
//   • Hover scrubber with a vertical guide + tooltip card on the right
export default function CashPositionChart({
  start, points, lowWaterISO, biggestOutISO,
}: {
  start: number;
  points: Pt[];
  lowWaterISO: string;
  biggestOutISO: string;
}) {
  const gid = useId().replace(/[:]/g, '');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const geom = useMemo(() => {
    const W = 1200, H = 320;
    const padL = 70, padR = 24, padT = 24, padB = 38;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const all = [start, ...points.map(p => p.balance)];
    const rawMax = Math.max(...all);
    const rawMin = Math.min(...all);
    // Anchor zero in the plot when the range straddles it; otherwise leave
    // a 6% breathing band above max + below min so glyphs don't clip.
    const pad = (rawMax - rawMin) * 0.08;
    const max = rawMax + pad;
    const min = rawMin > 0 ? 0 : rawMin - pad;
    const x = (i: number) => padL + (i / Math.max(1, points.length)) * innerW;
    const y = (v: number) => padT + innerH - ((v - min) / Math.max(1, max - min)) * innerH;
    // Series including the start "today" point, anchored at x(0).
    const series = [start, ...points.map(p => p.balance)];

    // Smooth path via centripetal-style Catmull–Rom → Bézier conversion. For
    // each segment, pick control points 1/6 of the way toward the previous
    // and next sample, giving a soft S-curve without distance ringing.
    let line = `M ${x(0).toFixed(1)} ${y(series[0]).toFixed(1)}`;
    for (let i = 1; i < series.length; i++) {
      const x0 = x(i - 2 < 0 ? 0 : i - 2), y0 = y(series[i - 2] ?? series[0]);
      const x1 = x(i - 1), y1 = y(series[i - 1]);
      const x2 = x(i),     y2 = y(series[i]);
      const x3 = x(i + 1 >= series.length ? series.length - 1 : i + 1),
            y3 = y(series[i + 1] ?? series[series.length - 1]);
      const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
      const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
      line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    const area = `${line} L ${x(series.length - 1).toFixed(1)} ${y(min).toFixed(1)} L ${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`;
    return { W, H, padL, padR, padT, padB, innerW, innerH, max, min, x, y, line, area, series };
  }, [start, points]);

  if (points.length === 0) return null;

  const lowWaterIdx   = points.findIndex(p => p.dateISO === lowWaterISO);
  const biggestOutIdx = points.findIndex(p => p.dateISO === biggestOutISO);
  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const { W, H, padL, padR, padT, padB, innerW, innerH, max, min, x, y, line, area, series } = geom;

  // Pre-compute weekend bands: for each point, if it's a Sat/Sun, draw a
  // thin background stripe. Saturday is day index 6 in UTC; Sunday is 0.
  const weekendBands: Array<{ x: number; w: number }> = [];
  let runStart: number | null = null;
  points.forEach((p, i) => {
    const dow = new Date(p.dateISO + 'T00:00:00Z').getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend && runStart == null) runStart = i;
    if (!isWeekend && runStart != null) {
      weekendBands.push({ x: x(runStart + 0.5), w: x(i + 0.5) - x(runStart + 0.5) });
      runStart = null;
    }
  });
  if (runStart != null) weekendBands.push({ x: x(runStart + 0.5), w: x(points.length + 0.5) - x(runStart + 0.5) });

  // Y-axis ticks at quartiles. Round nicely if range is large.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => min + (max - min) * t);

  // Date labels: ticks every ~14 days, plus the first and last.
  const labelEveryN = points.length > 60 ? 14 : 7;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet"
           onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="55%"  stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
          <clipPath id={`clip-${gid}`}>
            <rect x={padL} y={padT} width={innerW} height={innerH} />
          </clipPath>
          <filter id={`glow-${gid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Weekend bands */}
        <g clipPath={`url(#clip-${gid})`}>
          {weekendBands.map((b, i) => (
            <rect key={i} x={b.x} y={padT} width={b.w} height={innerH}
                  fill="var(--fg)" opacity="0.025" />
          ))}
        </g>

        {/* Y-axis gridlines + labels */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
                  stroke="var(--border)" strokeOpacity="0.6"
                  strokeDasharray={i === 0 || (min < 0 && Math.abs(v) < 0.01) ? '0' : '2 5'} />
            <text x={padL - 10} y={y(v) + 3} textAnchor="end"
                  fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">
              {fmt(v, { cents: false, compact: true })}
            </text>
          </g>
        ))}
        {/* Zero line - heavier when the chart straddles zero */}
        {min < 0 && (
          <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)}
                stroke="var(--error)" strokeWidth="1" opacity="0.55" />
        )}

        {/* Today vertical guide */}
        <line x1={x(0)} x2={x(0)} y1={padT} y2={H - padB}
              stroke="var(--fg-subtle)" strokeDasharray="2 4" opacity="0.5" />
        <text x={x(0)} y={padT - 8} textAnchor="middle"
              fontFamily="var(--font-product)" fontSize="9" fontWeight="700"
              fill="var(--fg-muted)" letterSpacing="0.08em">TODAY</text>

        {/* Area + line */}
        <g clipPath={`url(#clip-${gid})`}>
          <path d={area} fill={`url(#grad-${gid})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"
                filter={`url(#glow-${gid})`} />
        </g>

        {/* Biggest outflow marker - full-height dotted guide */}
        {biggestOutIdx >= 0 && (
          <line x1={x(biggestOutIdx + 1)} x2={x(biggestOutIdx + 1)} y1={padT} y2={H - padB}
                stroke="var(--error)" strokeDasharray="3 4" opacity="0.35" />
        )}

        {/* Event glyphs */}
        {points.map((p, i) => {
          const cx = x(i + 1), cy = y(p.balance);
          const out: any[] = [];
          if (p.outflow > 0) {
            out.push(
              <polygon key={`out-${i}`}
                points={`${cx},${cy + 5} ${cx - 4},${cy - 2} ${cx + 4},${cy - 2}`}
                fill="var(--error)" opacity="0.85" transform={`rotate(180 ${cx} ${cy + 1})`} />,
            );
          }
          if (p.inflow > 0) {
            out.push(
              <polygon key={`in-${i}`}
                points={`${cx},${cy - 5} ${cx - 4},${cy + 2} ${cx + 4},${cy + 2}`}
                fill="var(--success)" opacity="0.9" />,
            );
          }
          if (p.transferIn > 0 || p.transferOut > 0 || p.transferNeutral > 0) {
            out.push(
              <rect key={`tx-${i}`}
                x={cx - 3} y={cy - 3} width="6" height="6"
                transform={`rotate(45 ${cx} ${cy})`}
                fill="var(--link)" opacity="0.85" />,
            );
          }
          return out;
        })}

        {/* Low-water emphasis */}
        {lowWaterIdx >= 0 && (
          <g>
            <circle cx={x(lowWaterIdx + 1)} cy={y(points[lowWaterIdx].balance)} r="7"
                    fill="none" stroke="var(--warning)" strokeWidth="2" />
            <circle cx={x(lowWaterIdx + 1)} cy={y(points[lowWaterIdx].balance)} r="3"
                    fill="var(--warning)" />
            <text x={x(lowWaterIdx + 1)} y={y(points[lowWaterIdx].balance) - 14}
                  textAnchor="middle"
                  fontFamily="var(--font-product)" fontSize="9" fontWeight="700"
                  fill="var(--warning)" letterSpacing="0.06em">LOW</text>
          </g>
        )}

        {/* X-axis date labels */}
        {points.map((p, i) => {
          if (!(i === 0 || i === points.length - 1 || (i + 1) % labelEveryN === 0)) return null;
          return (
            <text key={`x-${i}`} x={x(i + 1)} y={H - 14}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">
              {p.dateISO.slice(5)}
            </text>
          );
        })}

        {/* Hover capture lanes */}
        {points.map((_, i) => (
          <rect key={`hit-${i}`} x={x(i + 1) - innerW / points.length / 2}
                y={padT} width={innerW / points.length} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)} />
        ))}

        {/* Hover scrubber */}
        {hoverIdx != null && (
          <g>
            <line x1={x(hoverIdx + 1)} x2={x(hoverIdx + 1)} y1={padT} y2={H - padB}
                  stroke="var(--fg-muted)" strokeDasharray="2 3" opacity="0.7" />
            <circle cx={x(hoverIdx + 1)} cy={y(points[hoverIdx].balance)} r="5"
                    fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Legend (always visible - short + unobtrusive) */}
      <div style={{
        position: 'absolute', top: 10, left: 90,
        display: 'flex', gap: 14, fontSize: 10, color: 'var(--fg-muted)',
        fontFamily: 'var(--font-product)', fontWeight: 600, letterSpacing: '0.04em',
      }}>
        <LegendMark color="var(--success)" shape="up">INFLOW</LegendMark>
        <LegendMark color="var(--error)"   shape="down">OUTFLOW</LegendMark>
        <LegendMark color="var(--link)"    shape="diamond">TRANSFER</LegendMark>
      </div>

      {/* Tooltip card */}
      {hover && (
        <div style={{
          position: 'absolute', top: 8, right: 28,
          padding: 12, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          fontSize: 11, color: 'var(--fg-strong)',
          minWidth: 220, boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{
            fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: 6,
          }}>{prettyDate(hover.dateISO)}</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700,
            color: hover.balance < 0 ? 'var(--error)' : 'var(--fg-strong)', marginBottom: 8,
          }}>{fmt(hover.balance)}</div>

          {hover.inflow > 0 && (
            <Row color="var(--success)" label="Income" value={`+${fmt(hover.inflow)}`} />
          )}
          {hover.outflow > 0 && (
            <Row color="var(--error)" label="Bills" value={`−${fmt(hover.outflow)}`} />
          )}
          {hover.transferIn > 0 && (
            <Row color="var(--link)" label="Transfer in" value={`+${fmt(hover.transferIn)}`} />
          )}
          {hover.transferOut > 0 && (
            <Row color="var(--link)" label="Transfer out" value={`−${fmt(hover.transferOut)}`} />
          )}
          {hover.transferNeutral > 0 && (
            <Row color="var(--link)" label="Move (between liquid)" value={fmt(hover.transferNeutral)} subtle />
          )}

          {hover.notes.length > 0 && (
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
              fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5,
            }}>
              {hover.notes.slice(0, 5).map((n, i) => <div key={i}>· {n}</div>)}
              {hover.notes.length > 5 && <div>· +{hover.notes.length - 5} more</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ color, label, value, subtle }: { color: string; label: string; value: string; subtle?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 11, color: subtle ? 'var(--fg-muted)' : 'var(--fg)', marginBottom: 3,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: subtle ? 0.4 : 0.85 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function LegendMark({ color, shape, children }: { color: string; shape: 'up' | 'down' | 'diamond'; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: 'block' }}>
        {shape === 'up'      && <polygon points="5,1 9,8 1,8" fill={color} />}
        {shape === 'down'    && <polygon points="1,2 9,2 5,9" fill={color} />}
        {shape === 'diamond' && <rect x="2.5" y="2.5" width="5" height="5" transform="rotate(45 5 5)" fill={color} />}
      </svg>
      {children}
    </span>
  );
}

function prettyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
