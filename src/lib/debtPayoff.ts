// Debt-payoff planner (v0.5.0). Given a set of debts (balance + APR + minimum
// payment) and a monthly payment budget, simulates month-by-month payoff under
// the two classic strategies and compares them:
//
//   • avalanche — extra goes to the HIGHEST-APR debt first (minimizes interest)
//   • snowball  — extra goes to the SMALLEST-BALANCE debt first (fastest wins)
//
// Both pay every debt's minimum each month; whatever budget is left after
// minimums (including minimums freed as debts are cleared) rolls onto the
// current target. Pure + deterministic — no DB, no dates-from-now (the caller
// stamps real dates), so it's unit-testable.

export type Debt = {
  id: string;
  name: string;
  balance: number;        // current payoff balance (positive dollars owed)
  apr: number;            // annual percentage rate, e.g. 19.99
  minimumPayment: number; // required monthly minimum
};

export type PayoffStep = {
  debtId: string;
  name: string;
  payoffMonth: number;    // 1-based month index when this debt hits $0
  interestPaid: number;   // total interest accrued on this debt over the plan
};

export type PayoffPlan = {
  strategy: 'avalanche' | 'snowball';
  feasible: boolean;      // false when the budget can't cover minimums / debts grow forever
  reason?: string;        // why infeasible
  months: number;         // months to debt-free
  totalInterest: number;
  totalPaid: number;      // principal + interest paid across the plan
  order: PayoffStep[];    // debts in the month-order they get cleared
};

const MAX_MONTHS = 600; // 50-year safety cap
const cents = (n: number) => Math.round(n * 100) / 100;

function orderFor(debts: Debt[], strategy: 'avalanche' | 'snowball'): Debt[] {
  const live = debts.filter(d => d.balance > 0.005);
  return [...live].sort((a, b) =>
    strategy === 'avalanche'
      ? (b.apr - a.apr) || (a.balance - b.balance)   // highest APR; tie → smaller balance
      : (a.balance - b.balance) || (b.apr - a.apr));  // smallest balance; tie → higher APR
}

export function planPayoff(debts: Debt[], monthlyBudget: number, strategy: 'avalanche' | 'snowball'): PayoffPlan {
  // Work on copies so callers' objects aren't mutated.
  const state = debts
    .filter(d => d.balance > 0.005)
    .map(d => ({ id: d.id, name: d.name, balance: d.balance, apr: Math.max(0, d.apr), min: Math.max(0, d.minimumPayment), interest: 0, payoffMonth: 0 }));

  if (state.length === 0) {
    return { strategy, feasible: true, months: 0, totalInterest: 0, totalPaid: 0, order: [] };
  }

  const totalMinimums = state.reduce((s, d) => s + Math.min(d.min, d.balance), 0);
  if (monthlyBudget < totalMinimums - 0.005) {
    return {
      strategy, feasible: false,
      reason: `Monthly budget ${monthlyBudget.toFixed(2)} is below the combined minimum payments ${cents(totalMinimums).toFixed(2)}.`,
      months: 0, totalInterest: 0, totalPaid: 0, order: [],
    };
  }

  // Static target ordering (avalanche/snowball don't re-rank as balances change,
  // except that a cleared debt is skipped). Snowball's "smallest balance" is
  // fixed at the starting balances — the canonical definition.
  const targetOrder = orderFor(debts, strategy).map(d => d.id);
  const byId = new Map(state.map(d => [d.id, d]));

  let totalInterest = 0, totalPaid = 0, month = 0;
  while (state.some(d => d.balance > 0.005)) {
    month++;
    if (month > MAX_MONTHS) {
      return {
        strategy, feasible: false,
        reason: 'Debts do not pay off within 50 years at this budget (likely negative amortization — minimums below monthly interest).',
        months: MAX_MONTHS, totalInterest: cents(totalInterest), totalPaid: cents(totalPaid), order: [],
      };
    }

    // 1. Accrue one month of interest on every live debt.
    for (const d of state) {
      if (d.balance <= 0.005) continue;
      const i = d.balance * (d.apr / 100 / 12);
      d.balance += i; d.interest += i; totalInterest += i;
    }

    // 2. Pay minimums (capped at the balance), tracking budget left for extra.
    let available = monthlyBudget;
    for (const d of state) {
      if (d.balance <= 0.005) continue;
      const pay = Math.min(d.min, d.balance, available);
      d.balance -= pay; available -= pay; totalPaid += pay;
    }

    // 3. Roll the remainder onto the current target (first uncleared in order).
    for (const id of targetOrder) {
      if (available <= 0.005) break;
      const d = byId.get(id)!;
      if (d.balance <= 0.005) continue;
      const pay = Math.min(available, d.balance);
      d.balance -= pay; available -= pay; totalPaid += pay;
    }

    // 4. Stamp payoff month for any debt cleared this month.
    for (const d of state) {
      if (d.payoffMonth === 0 && d.balance <= 0.005) d.payoffMonth = month;
    }
  }

  const order: PayoffStep[] = state
    .map(d => ({ debtId: d.id, name: d.name, payoffMonth: d.payoffMonth, interestPaid: cents(d.interest) }))
    .sort((a, b) => a.payoffMonth - b.payoffMonth);

  return {
    strategy, feasible: true,
    months: month,
    totalInterest: cents(totalInterest),
    totalPaid: cents(totalPaid),
    order,
  };
}

export type PayoffComparison = {
  monthlyBudget: number;
  totalBalance: number;
  totalMinimums: number;
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  // Avalanche always pays ≤ interest vs snowball; surface the saving + the
  // month difference so the UI can recommend.
  interestSavedByAvalanche: number;
  monthsDifference: number; // snowball.months − avalanche.months (≥0 typically)
  recommended: 'avalanche' | 'snowball';
};

export function comparePayoff(debts: Debt[], monthlyBudget: number): PayoffComparison {
  const avalanche = planPayoff(debts, monthlyBudget, 'avalanche');
  const snowball = planPayoff(debts, monthlyBudget, 'snowball');
  const totalBalance = cents(debts.reduce((s, d) => s + Math.max(0, d.balance), 0));
  const totalMinimums = cents(debts.filter(d => d.balance > 0.005).reduce((s, d) => s + Math.max(0, d.minimumPayment), 0));
  const interestSaved = (avalanche.feasible && snowball.feasible)
    ? cents(snowball.totalInterest - avalanche.totalInterest)
    : 0;
  return {
    monthlyBudget,
    totalBalance,
    totalMinimums,
    avalanche,
    snowball,
    interestSavedByAvalanche: interestSaved,
    monthsDifference: (avalanche.feasible && snowball.feasible) ? snowball.months - avalanche.months : 0,
    // Avalanche minimizes interest; recommend it unless snowball clears in the
    // same time (then snowball's quick wins are a free motivational bonus).
    recommended: interestSaved > 0 ? 'avalanche' : 'snowball',
  };
}
