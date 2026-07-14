// Server-side glue between the debt accounts in the DB and the pure
// debtPayoff simulator. Loads credit/loan accounts (balances stored negative
// for liabilities → flipped to positive owed) with their user-entered APR +
// minimum payment.
import { prisma } from './prisma';
import { resolvedKind } from './accountKind';
import { comparePayoff, type Debt, type PayoffComparison } from './debtPayoff';

export type DebtAccount = Debt & { hasInputs: boolean };

export async function loadDebtAccounts(): Promise<DebtAccount[]> {
  const accts = await prisma.bankAccount.findMany({
    select: { id: true, name: true, kind: true, type: true, subtype: true, balance: true, apr: true, minimumPayment: true },
  });
  return accts
    .filter(a => { const k = resolvedKind(a); return k === 'credit' || k === 'loan'; })
    .map(a => ({
      id: a.id,
      name: a.name,
      balance: Math.abs(a.balance ?? 0), // liabilities stored negative → owed is positive
      apr: a.apr ?? 0,
      minimumPayment: a.minimumPayment ?? 0,
      hasInputs: a.apr != null && a.minimumPayment != null,
    }))
    .filter(d => d.balance > 0.005)
    .sort((a, b) => b.apr - a.apr);
}

export type DebtPlan = {
  accounts: DebtAccount[];
  comparison: PayoffComparison | null; // null when no usable debts
  missingInputs: number;               // debts lacking apr/minimum
  suggestedBudget: number;             // sum of minimums (a sensible default floor)
};

export async function buildDebtPlan(monthlyBudget?: number): Promise<DebtPlan> {
  const accounts = await loadDebtAccounts();
  const usable = accounts.filter(a => a.hasInputs);
  const totalMinimums = Math.round(usable.reduce((s, a) => s + a.minimumPayment, 0) * 100) / 100;
  // Default budget: minimums + a modest $100 of extra, so the plan shows real
  // progress out of the box. Caller can override.
  const budget = monthlyBudget ?? Math.max(totalMinimums + 100, totalMinimums);
  return {
    accounts,
    comparison: usable.length > 0 ? comparePayoff(usable, budget) : null,
    missingInputs: accounts.length - usable.length,
    suggestedBudget: totalMinimums,
  };
}
