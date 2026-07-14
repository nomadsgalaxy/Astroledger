import { describe, it, expect } from 'vitest';
import { planPayoff, comparePayoff, type Debt } from '../src/lib/debtPayoff';

const D = (id: string, balance: number, apr: number, minimumPayment: number): Debt => ({ id, name: id, balance, apr, minimumPayment });

describe('planPayoff', () => {
  it('a single 0% debt pays off in ceil(balance / budget) months with no interest', () => {
    const p = planPayoff([D('a', 1000, 0, 50)], 500, 'avalanche');
    expect(p.feasible).toBe(true);
    expect(p.totalInterest).toBe(0);
    expect(p.months).toBe(2); // 500 + 500
    expect(p.order[0].payoffMonth).toBe(2);
  });

  it('no debts → feasible, zero everything', () => {
    const p = planPayoff([], 500, 'snowball');
    expect(p.feasible).toBe(true);
    expect(p.months).toBe(0);
    expect(p.order).toHaveLength(0);
  });

  it('infeasible when budget cannot cover combined minimums', () => {
    const p = planPayoff([D('a', 5000, 20, 150), D('b', 3000, 18, 100)], 200, 'avalanche');
    expect(p.feasible).toBe(false);
    expect(p.reason).toMatch(/minimum/i);
  });

  it('avalanche clears the highest-APR debt first; snowball clears the smallest balance first', () => {
    const debts = [D('big-lowrate', 8000, 5, 100), D('small-hirate', 2000, 25, 50)];
    const av = planPayoff(debts, 600, 'avalanche');
    const sn = planPayoff(debts, 600, 'snowball');
    // avalanche targets the 25% debt first
    expect(av.order[0].debtId).toBe('small-hirate');
    // snowball also targets the smaller balance first here (same debt) — both clear small-hirate first
    expect(sn.order[0].debtId).toBe('small-hirate');
    // construct a case where they DIFFER: small balance is also low APR
    const debts2 = [D('small-lowrate', 1000, 6, 25), D('big-hirate', 9000, 24, 200)];
    expect(planPayoff(debts2, 700, 'avalanche').order[0].debtId).toBe('big-hirate');
    expect(planPayoff(debts2, 700, 'snowball').order[0].debtId).toBe('small-lowrate');
  });

  it('interest accrues on a balance carried at APR (sanity: ~1 month of interest on minimum-only)', () => {
    // $1000 at 12% APR, pay exactly the interest ($10/mo) → never amortizes → infeasible-by-cap
    const p = planPayoff([D('a', 1000, 12, 10)], 10, 'avalanche');
    expect(p.feasible).toBe(false);
    expect(p.reason).toMatch(/50 years|negative amortization/i);
  });
});

describe('comparePayoff', () => {
  it('avalanche pays ≤ interest vs snowball when rates differ, and is recommended', () => {
    const debts = [D('small-lowrate', 1000, 6, 25), D('big-hirate', 9000, 24, 200)];
    const c = comparePayoff(debts, 700);
    expect(c.avalanche.feasible && c.snowball.feasible).toBe(true);
    expect(c.avalanche.totalInterest).toBeLessThanOrEqual(c.snowball.totalInterest);
    expect(c.interestSavedByAvalanche).toBeGreaterThan(0);
    expect(c.recommended).toBe('avalanche');
    expect(c.totalBalance).toBe(10000);
  });

  it('recommends snowball when interest is identical (e.g. all same APR)', () => {
    const debts = [D('a', 1000, 10, 25), D('b', 4000, 10, 80)];
    const c = comparePayoff(debts, 600);
    expect(c.interestSavedByAvalanche).toBe(0);
    expect(c.recommended).toBe('snowball');
  });
});
