import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, Btn, Pill, fmt } from '../../../_components/atoms';
import ForecastRunButton from '../../../_components/ForecastRunButton';
import ForecastActions from '../../../_components/ForecastActions';
import CashPositionChart from '../../../_components/CashPositionChart';
import { projectCashflow } from '@/lib/cashflowProjection';

export const dynamic = 'force-dynamic';

export default async function ForecastPage() {
  const projection = await projectCashflow(90);
  const latest = await prisma.forecast.findMany({
    where: { scope: { in: ['overall', 'category'] }, method: { in: ['composite', 'long_term_extrapolation'] } },
    orderBy: { generatedAt: 'desc' },
    take: 120,
    include: { points: { orderBy: { month: 'asc' } } },
  });

  // Disambiguate the three overall flows (outflow / inflow / net) — they share
  // scope+method, so each finder must also match `flow`.
  const overall      = latest.find(f => f.scope === 'overall' && f.method === 'composite' && f.flow === 'outflow');
  const longTerm     = latest.find(f => f.scope === 'overall' && f.method === 'long_term_extrapolation' && f.flow === 'outflow');
  const incomeFc     = latest.find(f => f.scope === 'overall' && f.method === 'composite' && f.flow === 'inflow');
  const incomeLong   = latest.find(f => f.scope === 'overall' && f.method === 'long_term_extrapolation' && f.flow === 'inflow');
  const netFc        = latest.find(f => f.scope === 'overall' && f.method === 'composite' && f.flow === 'net');
  const netLong      = latest.find(f => f.scope === 'overall' && f.method === 'long_term_extrapolation' && f.flow === 'net');
  const categoryFc = latest.filter(f => f.scope === 'category').reduce((map, f) => {
    if (!map.has(f.scopeKey!)) map.set(f.scopeKey!, f);
    return map;
  }, new Map<string, typeof latest[number]>());

  // 12-month projected totals for the headline (income / spending / net).
  const sum = (f: typeof latest[number] | undefined) => f?.points.reduce((s, p) => s + p.point, 0) ?? 0;
  const proj12Income = sum(incomeFc);
  const proj12Spend  = sum(overall);
  const proj12Net    = proj12Income - proj12Spend;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={overall ? `Generated ${new Date(overall.generatedAt).toLocaleString()}` : 'No forecast yet'}
        title="Forecast"
        subtitle="12-month composite (recurring + Holt-Winters on variable spend), plus 5-year directional extrapolation."
        right={<div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ForecastActions hasForecasts={latest.length > 0} />
          <ForecastRunButton />
        </div>}
      />

      <Card eyebrow="Next 90 days" title="Daily cash position"
            action={
              <Pill tone={projection.lowWater.balance < 0 ? 'error' : projection.lowWater.balance < 500 ? 'warning' : 'success'}>
                Low: {fmt(projection.lowWater.balance, { cents: false })} on {projection.lowWater.dateISO.slice(5)}
              </Pill>
            }>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12, lineHeight: 1.6 }}>
          Starting from <strong>{fmt(projection.start.balance, { cents: false })}</strong> in liquid cash
          {projection.balanceStaleDays > 3 && projection.balanceAsOf
            ? <> (balance as of <strong style={{ color: 'var(--warning)' }}>{projection.balanceAsOf}</strong>, {projection.balanceStaleDays}d ago — sync to refresh)</>
            : ' today'}.
          Projects subscriptions + anticipated charges + {projection.recurringInflowsDetected} recurring income stream{projection.recurringInflowsDetected === 1 ? '' : 's'} + {projection.recurringTransfersDetected} recurring transfer{projection.recurringTransfersDetected === 1 ? '' : 's'}
          {projection.dailyVariableBurn > 0 && <> + ~<strong>{fmt(projection.dailyVariableBurn, { cents: false })}/day</strong> typical everyday spending</>}
          {' '}across the next 90 days.
        </div>
        <CashPositionChart
          start={projection.start.balance}
          points={projection.points}
          lowWaterISO={projection.lowWater.dateISO}
          biggestOutISO={projection.biggestOut.dateISO}
        />
        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ color: 'var(--fg-muted)' }}>Total in: <strong style={{ color: 'var(--success)' }}>+{fmt(projection.totalIn, { cents: false })}</strong></span>
          <span style={{ color: 'var(--fg-muted)' }}>Total out: <strong style={{ color: 'var(--error)' }}>−{fmt(projection.totalOut, { cents: false })}</strong></span>
          <span style={{ color: 'var(--fg-muted)' }}>Net: <strong>{(projection.totalIn - projection.totalOut) >= 0 ? '+' : '−'}{fmt(Math.abs(projection.totalIn - projection.totalOut), { cents: false })}</strong></span>
          {projection.totalTransferred > 0 && (
            <span style={{ color: 'var(--fg-muted)' }}>Transferred: <strong style={{ color: 'var(--link)' }}>{fmt(projection.totalTransferred, { cents: false })}</strong></span>
          )}
          <span style={{ color: 'var(--fg-muted)' }}>Biggest day out: <strong>{fmt(projection.biggestOut.outflow, { cents: false })}</strong> on {projection.biggestOut.dateISO.slice(5)}</span>
        </div>
      </Card>

      {!overall ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No forecast generated yet</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Need at least 12 months of transactions for seasonal forecasting. Less than that → falls back to moving averages.
            </div>
            <ForecastRunButton />
          </div>
        </Card>
      ) : (
        <>
          {incomeFc && (
            <Card eyebrow="Next 12 months · projected" title="Income vs. spending"
                  action={<Pill tone={proj12Net >= 0 ? 'success' : 'error'}>{proj12Net >= 0 ? 'Surplus' : 'Deficit'} {fmt(Math.abs(proj12Net), { cents: false })}</Pill>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                <Stat label="Projected income" value={`+${fmt(proj12Income, { cents: false })}`} color="var(--success)" />
                <Stat label="Projected spending" value={`−${fmt(proj12Spend, { cents: false })}`} color="var(--error)" />
                <Stat label="Projected net" value={`${proj12Net >= 0 ? '+' : '−'}${fmt(Math.abs(proj12Net), { cents: false })}`}
                      color={proj12Net >= 0 ? 'var(--fg-strong)' : 'var(--error)'} />
              </div>
            </Card>
          )}

          <Card eyebrow="Next 12 months · overall outflow" title="Spending forecast">
            <ForecastChart
              points={overall.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high }))}
              longTermPoints={longTerm?.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high })) ?? []}
            />
          </Card>

          {incomeFc && (
            <Card eyebrow="Next 12 months · overall income" title="Income forecast">
              <ForecastChart color="var(--success)"
                points={incomeFc.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high }))}
                longTermPoints={incomeLong?.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high })) ?? []}
              />
            </Card>
          )}

          {netFc && (
            <Card eyebrow="Next 12 months · net (income − spending)" title="Monthly net forecast">
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                Projected monthly surplus (above the zero line) or shortfall (below). The directional dashed extension runs to 5 years.
              </div>
              <ForecastChart color="var(--link)" allowNegative
                points={netFc.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high }))}
                longTermPoints={netLong?.points.map(p => ({ month: p.month.toISOString(), point: p.point, low: p.low, high: p.high })) ?? []}
              />
            </Card>
          )}

          <Card eyebrow="Per category" title="Top 9 categories" padding={18}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {[...categoryFc.values()]
                .map(f => ({ name: f.scopeKey!, points: f.points, total: f.points.reduce((s, p) => s + p.point, 0) }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 9)
                .map(c => (
                  <div key={c.name} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{c.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>~{fmt(c.total / c.points.length, { cents: false })}/mo</span>
                    </div>
                    <MiniSpark points={c.points.map(p => p.point)} />
                  </div>
                ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ForecastChart({ points, longTermPoints, color = 'var(--accent)', allowNegative = false }: {
  points: Array<{ month: string; point: number; low: number; high: number }>;
  longTermPoints: Array<{ month: string; point: number; low: number; high: number }>;
  color?: string;
  allowNegative?: boolean;
}) {
  if (points.length === 0) return null;
  const all = [...points, ...longTermPoints];
  const W = 1200, H = 320;
  const padL = 60, padR = 20, padT = 20, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...all.map(p => p.high)) * 1.05;
  // Net forecasts can dip below zero; include the actual minimum (and the zero
  // baseline) so a deficit isn't clipped flat at the bottom.
  const min = allowNegative ? Math.min(0, ...all.map(p => p.low)) * 1.05 : 0;
  const px = (i: number) => padL + (i / Math.max(1, all.length - 1)) * innerW;
  const py = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const splitIdx = points.length;
  const bandPath = (slice: typeof all, indexOffset: number) => {
    const top = slice.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i + indexOffset)} ${py(p.high)}`).join(' ');
    const bot = slice.slice().reverse().map((p, i) => `L ${px(slice.length - 1 - i + indexOffset)} ${py(p.low)}`).join(' ');
    return top + ' ' + bot + ' Z';
  };
  const linePath = (slice: typeof all, indexOffset: number) =>
    slice.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i + indexOffset)} ${py(p.point)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: H, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {[0.25, 0.5, 0.75, 1].map(g => (
        <line key={g} x1={padL} x2={W - padR} y1={py(max * g)} y2={py(max * g)} stroke="var(--border)" strokeDasharray="2 4" />
      ))}
      {allowNegative && min < 0 && (
        <line x1={padL} x2={W - padR} y1={py(0)} y2={py(0)} stroke="var(--fg-muted)" strokeWidth="1" opacity="0.5" />
      )}
      <path d={bandPath(points, 0)}                  fill={color} opacity="0.12" />
      {longTermPoints.length > 0 && <path d={bandPath(longTermPoints, splitIdx)} fill={color} opacity="0.06" />}
      <path d={linePath(points, 0)}                  fill="none" stroke={color} strokeWidth="2.5" />
      {longTermPoints.length > 0 && <path d={linePath(longTermPoints, splitIdx)} fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 4" opacity="0.6" />}
      {points.map((p, i) => (i % 3 === 0 || i === points.length - 1) && (
        <text key={i} x={px(i)} y={H - 8} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">
          {new Date(p.month).toLocaleString('en-US', { month: 'short' })}
        </text>
      ))}
      <text x={padL - 8} y={py(max)}  textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(max, { cents: false })}</text>
      <text x={padL - 8} y={py(min) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-subtle)">{fmt(min, { cents: false })}</text>
    </svg>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: color ?? 'var(--fg-strong)' }}>{value}</div>
    </div>
  );
}

function MiniSpark({ points }: { points: number[] }) {
  if (!points.length) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const w = 100, h = 30;
  const path = points.map((v, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }}>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
