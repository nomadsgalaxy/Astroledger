'use client';
import { useId } from 'react';
import { fmt } from './atoms';

type Point = { date: string; assets: number; liabilities: number; net: number };

export default function NetWorthHistoryChart({ history }: { history: Point[] }) {
  const gid = useId().replace(/:/g, '');
  if (history.length < 2) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Not enough data yet. Once a few transactions land or a daily snapshot fires, this chart fills in.</div>;
  }
  const W = 800, H = 220;
  const pad = { l: 50, r: 12, t: 12, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const minNet = Math.min(0, ...history.map(p => p.net));
  const maxNet = Math.max(0, ...history.map(p => p.net));
  const yMin = minNet - Math.max(1, (maxNet - minNet) * 0.08);
  const yMax = maxNet + Math.max(1, (maxNet - minNet) * 0.08);

  const px = (i: number) => pad.l + (i / Math.max(1, history.length - 1)) * innerW;
  const py = (v: number) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const linePath = history.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(p.net)}`).join(' ');
  // Two area fills: one closed against the zero line (rendered above), one
  // against the zero line (rendered below). Combined with clipPaths, the
  // visible result is "green where net was positive, red where negative".
  const areaToZero = `${linePath} L ${px(history.length - 1)} ${py(0)} L ${px(0)} ${py(0)} Z`;
  const last = history[history.length - 1];
  const first = history[0];
  const delta = last.net - first.net;
  // Color is applied via clipPaths split at y=0. Above-zero pixels render
  // from the green pair; below-zero pixels render from the red pair. The
  // end-dot uses last.net for its own color since it's a single point.
  const zeroY = py(0);
  const endDotColor = last.net < 0 ? 'var(--error)' : 'var(--success)';
  const deltaColor = delta >= 0 ? 'var(--success)' : 'var(--error)';

  // Y-axis ticks: zero + min + max
  const ticks = [yMin, 0, yMax].filter((v, i, arr) => arr.indexOf(v) === i);

  // X-axis labels: roughly 6 evenly spaced
  const labelEvery = Math.max(1, Math.floor(history.length / 6));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {history.length} snapshots · {first.date} → {last.date}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: deltaColor }}>
          {delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta), { cents: false })} over the window
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
        <defs>
          {/* Clips split the canvas at the zero line. Anything painted with
              `above` only renders where y < zeroY (i.e. net >= 0); `below`
              only where y > zeroY (net < 0). Pair each color with its clip. */}
          <clipPath id={`nw-above-${gid}`}>
            <rect x={0} y={0} width={W} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`nw-below-${gid}`}>
            <rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
          </clipPath>
        </defs>
        {/* Gridlines */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)}
                  stroke={Math.abs(v) < 0.001 ? 'var(--border-strong)' : 'var(--border)'}
                  strokeDasharray={Math.abs(v) < 0.001 ? undefined : '2 4'} />
            <text x={pad.l - 6} y={py(v) + 3} textAnchor="end"
                  fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">
              {v === 0 ? '$0' : `$${(Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v))}`}
            </text>
          </g>
        ))}
        {/* Area fills - green above zero, red below. Drawing one polygon
            twice and letting the clip masks reveal each half. */}
        <path d={areaToZero} fill="var(--success)" opacity={0.10} clipPath={`url(#nw-above-${gid})`} />
        <path d={areaToZero} fill="var(--error)" opacity={0.10} clipPath={`url(#nw-below-${gid})`} />
        {/* Same trick for the line: two strokes, each clipped to its half. */}
        <path d={linePath} fill="none" stroke="var(--success)"
              strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              clipPath={`url(#nw-above-${gid})`} />
        <path d={linePath} fill="none" stroke="var(--error)"
              strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              clipPath={`url(#nw-below-${gid})`} />
        <circle cx={px(history.length - 1)} cy={py(last.net)} r={4} fill={endDotColor} />
        {/* X-axis labels */}
        {history.map((p, i) => (i % labelEvery === 0 || i === history.length - 1) && (
          <text key={i} x={px(i)} y={H - 6} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">{p.date.slice(5)}</text>
        ))}
      </svg>
    </div>
  );
}
