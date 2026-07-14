import { describe, it, expect } from 'vitest';
import { statementsToCsv, type FinancialStatements } from '../src/lib/statements';

// Pure CSV serialization tests (no DB). Focus: formula-injection hardening and
// that totals/labels render correctly.
function fixture(overrides: Partial<FinancialStatements> = {}): FinancialStatements {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    period: { from: '2026-05-01', to: '2026-05-31' },
    baseCurrency: 'USD',
    balanceSheet: {
      asOf: '2026-05-31', baseCurrency: 'USD',
      assets: [{ kind: 'checking', label: 'Debit / Checking', total: 1000, accounts: [{ name: 'Checking', institution: 'Bank', balance: 1000 }] }],
      liabilities: [],
      totalAssets: 1000, totalLiabilities: 0, netWorth: 1000, notes: [],
    },
    incomeStatement: {
      from: '2026-05-01', to: '2026-05-31', baseCurrency: 'USD',
      income: [{ bucket: 'Salary', total: 2000, count: 1 }],
      expenses: [{ bucket: 'Groceries', total: 300, count: 4 }],
      totalIncome: 2000, totalExpenses: 300, netIncome: 1700, notes: [],
    },
    cashFlow: {
      from: '2026-05-01', to: '2026-05-31', baseCurrency: 'USD',
      operating: { inflows: 2000, outflows: 300, net: 1700 },
      investing: { net: 0 }, financing: { net: 0 }, other: { net: 0 },
      netChangeInCash: 1700, beginningCash: 0, endingCash: 1700, notes: [],
    },
    ...overrides,
  };
}

describe('statementsToCsv', () => {
  it('neutralizes formula-injection in user-controlled cells', () => {
    const s = fixture();
    s.balanceSheet.assets[0].accounts[0].name = '=cmd|/c calc';
    s.balanceSheet.assets[0].accounts[0].institution = '@SUM(A1:A9)';
    s.incomeStatement.expenses[0].bucket = '+HYPERLINK("http://evil")';
    const csv = statementsToCsv(s, 'all');
    // dangerous leading chars are apostrophe-guarded; cells are additionally
    // quote-wrapped only when they contain , " or newline (RFC-4180).
    expect(csv).toContain(`'=cmd|/c calc`);          // no comma → guarded, unquoted
    expect(csv).toContain(`'@SUM(A1:A9)`);            // no comma → guarded, unquoted
    expect(csv).toContain(`"'+HYPERLINK(""http://evil"")"`); // has quotes → quoted + doubled
    // no raw formula-leading cell survives (apostrophe always precedes it)
    expect(csv).not.toMatch(/(^|,)=cmd/);
    expect(csv).not.toMatch(/(^|,)@SUM/);
  });

  it('leaves legitimate negative numbers unquoted/unprefixed', () => {
    const s = fixture();
    s.cashFlow.operating.outflows = 300; // rendered as -300.00 in the CSV
    const csv = statementsToCsv(s, 'cash_flow');
    expect(csv).toContain('-300.00');
    expect(csv).not.toContain(`'-300.00`);
  });

  it('emits all three statements for "all"', () => {
    const csv = statementsToCsv(fixture(), 'all');
    expect(csv).toContain('Balance Sheet');
    expect(csv).toContain('Income Statement');
    expect(csv).toContain('Cash Flow Statement');
    expect(csv).toContain('Net Worth');
    expect(csv).toContain('Net Income');
  });
});
