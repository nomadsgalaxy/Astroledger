import { prisma } from '@/lib/prisma';
import { Card, Hex, SectionHeader, ProgressBar, Pill, fmt, fmtDate } from '../../../_components/atoms';
import GoalDialog from '../../../_components/GoalDialog';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  savings: 'Savings target',
  debt_payoff: 'Debt payoff',
  spend_under: 'Spending cap',
};

export default async function GoalsPage() {
  const goals = await prisma.goal.findMany({
    orderBy: [{ status: 'asc' }, { deadline: 'asc' }],
  });

  const active = goals.filter(g => g.status === 'active');
  const totalTarget = active.reduce((s, g) => s + g.targetAmount, 0);
  const totalCurrent = active.reduce((s, g) => s + g.currentAmount, 0);
  const overallPct = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${active.length} active · ${goals.length} total`}
        title="Goals"
        subtitle="Savings targets, debt payoff plans, and spending caps you committed to."
        right={<GoalDialog mode="create" label="+ New goal" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        <Card padding={20}><BigStat label="Total target" value={fmt(totalTarget, { cents: false })} /></Card>
        <Card padding={20}><BigStat label="Saved so far" value={fmt(totalCurrent, { cents: false })} color="var(--success)" /></Card>
        <Card padding={20}><BigStat label="Overall progress" value={`${overallPct}%`} color={overallPct >= 100 ? 'var(--success)' : 'var(--fg-strong)'} /></Card>
      </div>

      {goals.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>No goals yet</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Set a savings target (e.g. $5,000 emergency fund), debt payoff, or monthly spending cap.
            </div>
            <GoalDialog mode="create" label="Create your first goal" />
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18 }}>
          {goals.map(g => {
            const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
            const achieved = pct >= 100;
            const color = achieved ? 'var(--mode-simple)' : pct >= 70 ? 'var(--mode-advanced)' : 'var(--accent)';
            const daysLeft = g.deadline ? Math.ceil((+g.deadline - Date.now()) / 86400000) : null;
            return (
              <Card key={g.id} padding={0}>
                <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--border)' }}>
                  <Hex size={48} color={color}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: '#fff', textShadow: '0 1px 1px rgba(0,0,0,0.4)' }}>
                      {Math.round(pct)}
                    </span>
                  </Hex>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-caption" style={{ marginBottom: 2 }}>{KIND_LABELS[g.kind] ?? g.kind}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  </div>
                  {achieved && <Pill tone="success">Achieved</Pill>}
                </div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 22, color: 'var(--fg-strong)' }}>
                        {fmt(g.currentAmount, { cents: false })}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>of {fmt(g.targetAmount, { cents: false })}</div>
                    </div>
                    <ProgressBar value={g.currentAmount} max={g.targetAmount} height={8} color={color} />
                  </div>
                  {g.deadline && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--fg-muted)' }}>Deadline</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: daysLeft != null && daysLeft < 30 ? 'var(--warning)' : 'var(--fg-strong)' }}>
                        {fmtDate(g.deadline)} · {daysLeft != null ? `${daysLeft}d left` : ''}
                      </span>
                    </div>
                  )}
                  {g.notes && <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontStyle: 'italic' }}>{g.notes}</div>}
                  <div style={{ display: 'flex', gap: 6, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                    <GoalDialog mode="edit" label="Edit" goal={{
                      id: g.id, name: g.name, kind: g.kind,
                      targetAmount: g.targetAmount, currentAmount: g.currentAmount,
                      deadline: g.deadline, notes: g.notes,
                    }} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat" style={{ marginTop: 10, color: color ?? undefined }}>{value}</div>
    </div>
  );
}
