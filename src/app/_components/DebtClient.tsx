'use client';
import { useState, useCallback } from 'react';
import { Card, Btn, Pill, fmt } from './atoms';
import type { DebtPlan, DebtAccount } from '@/lib/debt';
import type { PayoffPlan } from '@/lib/debtPayoff';

function monthsLabel(m: number): string {
  if (m <= 0) return 'now';
  const y = Math.floor(m / 12), mo = m % 12;
  return [y ? `${y} yr` : '', mo ? `${mo} mo` : ''].filter(Boolean).join(' ') || '0 mo';
}
function debtFreeDate(m: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export default function DebtClient({ initial }: { initial: DebtPlan }) {
  const [plan, setPlan] = useState<DebtPlan>(initial);
  const [budget, setBudget] = useState<string>(
    initial.comparison ? String(initial.comparison.monthlyBudget) : String(initial.suggestedBudget || 0)
  );
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { apr?: string; min?: string }>>({});

  const refetch = useCallback(async (b?: string) => {
    setBusy(true);
    try {
      const q = (b ?? budget).trim();
      const r = await fetch(`/api/debt${q ? `?budget=${encodeURIComponent(q)}` : ''}`);
      if (r.ok) setPlan(await r.json());
    } finally { setBusy(false); }
  }, [budget]);

  async function saveInputs(a: DebtAccount) {
    const e = edits[a.id] ?? {};
    const apr = e.apr !== undefined ? parseFloat(e.apr) : a.apr;
    const min = e.min !== undefined ? parseFloat(e.min) : a.minimumPayment;
    if (!Number.isFinite(apr) || apr < 0 || apr > 100) return;
    if (!Number.isFinite(min) || min < 0) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/accounts/${a.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apr, minimumPayment: min }),
      });
      if (r.ok) { setEdits(s => ({ ...s, [a.id]: {} })); await refetch(); }
    } finally { setBusy(false); }
  }

  const c = plan.comparison;
  const rec = c?.recommended;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Debt accounts + inputs */}
      <Card eyebrow="Your debts" title="Credit & loan accounts" padding={0}
            action={<Pill tone="info">{plan.accounts.length} debt{plan.accounts.length === 1 ? '' : 's'}</Pill>}>
        {plan.accounts.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No credit or loan accounts with a balance. Mark an account as <strong>Credit</strong> or <strong>Loan</strong> on the Accounts page to plan its payoff.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 130px 140px 90px', gap: 12, padding: '10px 22px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)', fontSize: 10, fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
              <span>Account</span><span style={{ textAlign: 'right' }}>Balance</span><span style={{ textAlign: 'right' }}>APR %</span><span style={{ textAlign: 'right' }}>Min / mo</span><span />
            </div>
            {plan.accounts.map(a => {
              const e = edits[a.id] ?? {};
              const dirty = e.apr !== undefined || e.min !== undefined;
              return (
                <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 130px 140px 90px', gap: 12, padding: '12px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
                    {a.name}
                    {!a.hasInputs && <Pill tone="warning" style={{ marginLeft: 8, fontSize: 8 }}>needs APR + min</Pill>}
                  </div>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--error)' }}>{fmt(a.balance)}</span>
                  <input type="number" min="0" max="100" step="0.01" inputMode="decimal"
                         defaultValue={a.apr || ''} placeholder="0.00"
                         onChange={ev => setEdits(s => ({ ...s, [a.id]: { ...s[a.id], apr: ev.target.value } }))}
                         style={inp} />
                  <input type="number" min="0" step="1" inputMode="decimal"
                         defaultValue={a.minimumPayment || ''} placeholder="0"
                         onChange={ev => setEdits(s => ({ ...s, [a.id]: { ...s[a.id], min: ev.target.value } }))}
                         style={inp} />
                  <Btn variant={dirty ? 'primary' : 'outline'} size="sm" disabled={busy || !dirty} onClick={() => saveInputs(a)}>Save</Btn>
                </div>
              );
            })}
          </>
        )}
      </Card>

      {/* Budget + comparison */}
      {plan.missingInputs > 0 && (
        <div style={{ fontSize: 12, color: 'var(--warning)', padding: '0 4px' }}>
          {plan.missingInputs} debt{plan.missingInputs === 1 ? '' : 's'} still need an APR and minimum payment before they’re included in the plan.
        </div>
      )}

      {c && (
        <>
          <Card eyebrow="Step 2" title="How much can you put toward debt each month?">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
                Monthly payment budget
                <input type="number" min={plan.suggestedBudget} step="10" value={budget}
                       onChange={e => setBudget(e.target.value)}
                       onBlur={() => refetch()} onKeyDown={e => { if (e.key === 'Enter') refetch(); }}
                       style={{ ...inp, width: 160, fontSize: 15 }} />
              </label>
              <Btn variant="primary" size="md" disabled={busy} onClick={() => refetch()}>Recalculate</Btn>
              <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Minimums total {fmt(plan.suggestedBudget)}/mo. Anything above goes to the payoff target.</span>
            </div>
          </Card>

          {!c.avalanche.feasible ? (
            <Card eyebrow="Not enough" title="Budget too low">
              <div style={{ fontSize: 13, color: 'var(--error)' }}>{c.avalanche.reason}</div>
            </Card>
          ) : (
            <>
              <Card eyebrow="Recommendation" title={rec === 'avalanche' ? 'Avalanche saves you the most' : 'Snowball — quickest wins'}
                    action={<Pill tone="success">{rec === 'avalanche' ? 'Avalanche' : 'Snowball'}</Pill>}>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                  {c.interestSavedByAvalanche > 0 ? (
                    <>Paying highest-APR first (<strong>avalanche</strong>) saves <strong style={{ color: 'var(--success)' }}>{fmt(c.interestSavedByAvalanche)}</strong> in interest
                    {c.monthsDifference !== 0 && <> and finishes {monthsLabel(Math.abs(c.monthsDifference))} {c.monthsDifference > 0 ? 'sooner' : 'later'}</>} versus snowball.
                    Choose <strong>snowball</strong> instead if knocking out small balances early keeps you motivated.</>
                  ) : (
                    <>Both strategies cost the same interest here, so <strong>snowball</strong> (smallest balance first) gives you quicker wins at no extra cost.</>
                  )}
                </div>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <StrategyCard title="Avalanche" subtitle="Highest APR first" plan={c.avalanche} highlight={rec === 'avalanche'} names={nameMap(plan.accounts)} />
                <StrategyCard title="Snowball" subtitle="Smallest balance first" plan={c.snowball} highlight={rec === 'snowball'} names={nameMap(plan.accounts)} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function nameMap(accounts: DebtAccount[]): Record<string, string> {
  return Object.fromEntries(accounts.map(a => [a.id, a.name]));
}

function StrategyCard({ title, subtitle, plan, highlight, names }: {
  title: string; subtitle: string; plan: PayoffPlan; highlight: boolean; names: Record<string, string>;
}) {
  return (
    <Card eyebrow={subtitle} title={title}
          style={highlight ? { borderColor: 'var(--success)', boxShadow: '0 0 0 1px var(--success)' } : undefined}
          action={highlight ? <Pill tone="success">Recommended</Pill> : undefined}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <Mini label="Debt-free in" value={monthsLabel(plan.months)} />
        <Mini label="By" value={debtFreeDate(plan.months)} />
        <Mini label="Total interest" value={fmt(plan.totalInterest, { cents: false })} color="var(--error)" />
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>Payoff order</div>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.order.map(s => (
          <li key={s.debtId} style={{ fontSize: 12, color: 'var(--fg)' }}>
            <span style={{ fontWeight: 600 }}>{names[s.debtId] ?? s.name}</span>
            <span style={{ color: 'var(--fg-subtle)' }}> — paid off {monthsLabel(s.payoffMonth)} ({fmt(s.interestPaid, { cents: false })} interest)</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: 'var(--tr-wider)', fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: color ?? 'var(--fg-strong)' }}>{value}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 34, padding: '0 10px', textAlign: 'right',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
};
