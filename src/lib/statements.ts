// Accountant-style financial statements (v0.6.0):
//   - Balance Sheet      — assets vs liabilities, as of a point in time (today).
//   - Income Statement    — revenue vs expenses over a period (a.k.a. P&L).
//   - Cash Flow Statement — change in liquid cash over a period, decomposed
//                           into operating / investing / financing activity.
//
// Correctness notes (these are load-bearing — wrong signs or double-counting
// produce wrong statements):
//
//  * Asset vs liability is decided by resolvedKind()→isAsset() (liabilities are
//    exactly kinds 'credit' and 'loan'); see accountKind.ts. We NEVER infer it
//    from the stored balance sign, which is unreliable across providers.
//  * Account balances are STORED (BankAccount.balance), not summed from
//    transactions — an incomplete import history would otherwise mis-state them.
//    Investment account market value is ALREADY inside BankAccount.balance, so
//    we do NOT add holdingsSummary() on top (that would double-count).
//  * Transaction.amount is signed: negative = outflow/expense, positive =
//    inflow/income. That sign is the ONLY income/expense signal.
//  * Income/expense rollups exclude transfers (isTransfer:false), anticipated
//    placeholders (isAnticipated:false), and split PARENTS (isSplit:false — the
//    children carry the per-category amounts; counting both double-counts).
//  * Multi-currency: amounts are summed in base (USD) via baseAmount ?? amount;
//    account balances are converted with toBase(). Missing FX rates fall back to
//    face value and are surfaced as a note (lenient, matching holdings.ts).
//
// The Balance Sheet is rendered as of *today* (current stored balances). A
// historical as-of would require reconstructing past balances, which is exact
// for cash/credit but assumes investment balances were always at today's level
// (market drift isn't in Transaction rows) — too imprecise for an accounting
// statement, so it's intentionally out of scope here. The Cash Flow statement,
// by contrast, reconstructs liquid cash exactly (cash has no market drift).

import { prisma } from './prisma';
import { resolvedKind, isAsset, KIND_LABELS, KIND_ORDER, type AccountKind } from './accountKind';
import { toBase } from './fx';
import { BASE_CURRENCY } from './currencies';

// Liquid (cash & cash-equivalent) kinds — mirrors cashflowProjection.ts, which
// keeps this list module-private. Cash Flow operates on these accounts only;
// credit, loan, investment and retirement balances are not "cash".
const LIQUID_KINDS: AccountKind[] = ['checking', 'wallet', 'savings_short', 'savings_long'];
const INVESTING_KINDS: AccountKind[] = ['investment', 'savings_retirement'];
const FINANCING_KINDS: AccountKind[] = ['credit', 'loan'];

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- shared types -----------------------------------------------------------

export type AccountLine = { name: string; institution: string; balance: number };
export type KindGroup = { kind: AccountKind; label: string; total: number; accounts: AccountLine[] };

export type BalanceSheet = {
  asOf: string;                 // YYYY-MM-DD
  baseCurrency: string;
  assets: KindGroup[];
  liabilities: KindGroup[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  notes: string[];
};

export type StatementLine = { bucket: string; total: number; count: number };

export type IncomeStatement = {
  from: string;                 // YYYY-MM-DD inclusive
  to: string;                   // YYYY-MM-DD inclusive
  baseCurrency: string;
  income: StatementLine[];
  expenses: StatementLine[];    // positive magnitudes
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  notes: string[];
};

export type CashFlowStatement = {
  from: string;
  to: string;
  baseCurrency: string;
  operating: { inflows: number; outflows: number; net: number };
  investing: { net: number };           // transfers into/out of investment & retirement
  financing: { net: number };           // transfers into/out of credit & loan (debt)
  other: { net: number };               // liquid↔liquid (nets ~0), single-leg, misc
  netChangeInCash: number;
  beginningCash: number | null;
  endingCash: number | null;
  notes: string[];
};

export type FinancialStatements = {
  generatedAt: string;
  period: { from: string; to: string };
  baseCurrency: string;
  balanceSheet: BalanceSheet;
  incomeStatement: IncomeStatement;
  cashFlow: CashFlowStatement;
};

// --- helpers ----------------------------------------------------------------

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (s: string) => new Date(s + 'T00:00:00.000Z');
const dayEnd = (s: string) => new Date(s + 'T23:59:59.999Z');

/** USD value of a transaction, honoring foreign currency via baseAmount. */
function txBase(t: { amount: number; currency: string | null; baseAmount: number | null }): { v: number; fxMissing: boolean } {
  if (!t.currency || t.currency === BASE_CURRENCY) return { v: t.amount, fxMissing: false };
  if (t.baseAmount != null) return { v: t.baseAmount, fxMissing: false };
  return { v: t.amount, fxMissing: true }; // lenient: count foreign at face value, flag it
}

/** USD value of an account balance, converting the account's currency. */
async function balanceBase(a: { balance: number; currency: string | null }, asOf: Date): Promise<{ v: number; fxMissing: boolean }> {
  if (!a.currency || a.currency === BASE_CURRENCY) return { v: a.balance, fxMissing: false };
  const conv = await toBase(a.balance, a.currency, asOf);
  if (conv) return { v: conv.base, fxMissing: false };
  return { v: a.balance, fxMissing: true };
}

/** Single-bucket label for a transaction: primary tag → any tag → category → fallback. */
function bucketOf(
  t: { tags: Array<{ name: string; kind: string | null }>; category: { name: string } | null },
  fallback: string,
): string {
  const primary = t.tags.find(tag => tag.kind === 'primary');
  if (primary) return primary.name;
  if (t.tags.length > 0) return t.tags[0].name;
  if (t.category?.name) return t.category.name;
  return fallback;
}

function rollup(map: Map<string, { total: number; count: number }>): StatementLine[] {
  return Array.from(map.entries())
    .map(([bucket, v]) => ({ bucket, total: round2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total);
}

// --- Balance Sheet ----------------------------------------------------------

export async function buildBalanceSheet(opts: { asOf?: Date } = {}): Promise<BalanceSheet> {
  const asOf = opts.asOf ?? new Date();
  const accounts = await prisma.bankAccount.findMany({
    select: {
      name: true, type: true, subtype: true, kind: true, currency: true, balance: true,
      institution: { select: { name: true } },
    },
  });

  const assetGroups = new Map<AccountKind, KindGroup>();
  const liabGroups = new Map<AccountKind, KindGroup>();
  let skippedNoBalance = 0;
  let fxMissing = 0;

  for (const a of accounts) {
    if (a.balance == null) { skippedNoBalance++; continue; }
    const k = resolvedKind(a);
    const { v, fxMissing: miss } = await balanceBase({ balance: a.balance, currency: a.currency }, asOf);
    if (miss) fxMissing++;
    const groups = isAsset(k) ? assetGroups : liabGroups;
    // Assets keep their signed value (an overdrawn checking reduces assets);
    // liabilities are stored as positive magnitudes (debt owed).
    const lineBalance = isAsset(k) ? v : Math.abs(v);
    let g = groups.get(k);
    if (!g) { g = { kind: k, label: KIND_LABELS[k], total: 0, accounts: [] }; groups.set(k, g); }
    g.total = round2(g.total + lineBalance);
    g.accounts.push({ name: a.name, institution: a.institution.name, balance: round2(lineBalance) });
  }

  const order = (m: Map<AccountKind, KindGroup>) =>
    KIND_ORDER.filter(k => m.has(k)).map(k => {
      const g = m.get(k)!;
      g.accounts.sort((x, y) => y.balance - x.balance);
      return g;
    });

  const assets = order(assetGroups);
  const liabilities = order(liabGroups);
  const totalAssets = round2(assets.reduce((s, g) => s + g.total, 0));
  const totalLiabilities = round2(liabilities.reduce((s, g) => s + g.total, 0));

  const notes: string[] = [];
  if (skippedNoBalance > 0) notes.push(`${skippedNoBalance} account(s) have no balance on file and were excluded.`);
  if (fxMissing > 0) notes.push(`${fxMissing} non-USD balance(s) had no FX rate and were counted at face value.`);
  notes.push('Point-in-time snapshot using current account balances. Investment value is included via each account balance (not double-counted from holdings).');

  return {
    asOf: ymd(asOf),
    baseCurrency: BASE_CURRENCY,
    assets, liabilities,
    totalAssets, totalLiabilities,
    netWorth: round2(totalAssets - totalLiabilities),
    notes,
  };
}

// --- Income Statement (P&L) -------------------------------------------------

export async function buildIncomeStatement(opts: { from: Date; to: Date }): Promise<IncomeStatement> {
  const from = opts.from;
  const to = opts.to;
  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: from, lte: to },
      isTransfer: false,
      isAnticipated: false,
      isSplit: false, // exclude split parents; children carry per-category amounts
    },
    select: {
      amount: true, currency: true, baseAmount: true,
      tags: { select: { name: true, kind: true } },
      category: { select: { name: true } },
    },
  });

  const incomeMap = new Map<string, { total: number; count: number }>();
  const expenseMap = new Map<string, { total: number; count: number }>();
  let totalIncome = 0;
  let totalExpenses = 0;
  let fxMissing = 0;

  for (const t of txs) {
    const { v, fxMissing: miss } = txBase(t);
    if (miss) fxMissing++;
    if (v > 0) {
      const k = bucketOf(t, 'Other income');
      const cur = incomeMap.get(k) ?? { total: 0, count: 0 };
      cur.total += v; cur.count++; incomeMap.set(k, cur);
      totalIncome += v;
    } else if (v < 0) {
      const k = bucketOf(t, 'Uncategorized');
      const cur = expenseMap.get(k) ?? { total: 0, count: 0 };
      cur.total += -v; cur.count++; expenseMap.set(k, cur);
      totalExpenses += -v;
    }
  }

  const notes: string[] = [];
  if (fxMissing > 0) notes.push(`${fxMissing} non-USD transaction(s) had no FX rate and were counted at face value.`);
  notes.push('Cash-in vs cash-out by category over the period. Excludes internal transfers and anticipated (not-yet-synced) rows. Refunds appear as income (positive amounts), matching the rest of the app.');

  return {
    from: ymd(from), to: ymd(to),
    baseCurrency: BASE_CURRENCY,
    income: rollup(incomeMap),
    expenses: rollup(expenseMap),
    totalIncome: round2(totalIncome),
    totalExpenses: round2(totalExpenses),
    netIncome: round2(totalIncome - totalExpenses),
    notes,
  };
}

// --- Cash Flow Statement ----------------------------------------------------

export async function buildCashFlowStatement(opts: { from: Date; to: Date }): Promise<CashFlowStatement> {
  const from = opts.from;
  const to = opts.to;

  // Liquid accounts with a known balance — so flows and beginning/ending cash
  // reconcile over the same account set.
  const accounts = await prisma.bankAccount.findMany({
    select: { id: true, name: true, type: true, subtype: true, kind: true, currency: true, balance: true },
  });
  const liquid = accounts.filter(a => a.balance != null && LIQUID_KINDS.includes(resolvedKind(a)));
  const liquidIds = liquid.map(a => a.id);

  const notes: string[] = [];
  if (liquidIds.length === 0) {
    notes.push('No liquid (cash) accounts with a balance on file.');
    return {
      from: ymd(from), to: ymd(to), baseCurrency: BASE_CURRENCY,
      operating: { inflows: 0, outflows: 0, net: 0 },
      investing: { net: 0 }, financing: { net: 0 }, other: { net: 0 },
      netChangeInCash: 0, beginningCash: 0, endingCash: 0, notes,
    };
  }

  // Convert every cash figure (balances AND transactions) at ONE rate — the
  // period-end (`to`) rate — so beginning/ending cash reconstruct on a single
  // consistent FX basis. (The Income Statement, by contrast, values each
  // transaction at its own charge date via baseAmount; that's correct for P&L
  // but would make this cash reconstruction drift for foreign accounts.)
  const factorCache = new Map<string, number | null>(); // base USD per 1 unit, at `to`
  let fxMissing = 0;
  async function atTo(amount: number, currency: string | null): Promise<number> {
    if (!currency || currency === BASE_CURRENCY) return amount;
    if (!factorCache.has(currency)) {
      const conv = await toBase(1, currency, to);
      factorCache.set(currency, conv ? conv.base : null);
    }
    const f = factorCache.get(currency) ?? null;
    if (f == null) { fxMissing++; return amount; } // lenient: face value, flagged
    return amount * f;
  }

  let endingCash = 0;
  for (const a of liquid) endingCash += await atTo(a.balance as number, a.currency);

  // Subtract liquid transactions dated AFTER the period end so endingCash is the
  // balance as of `to` (exact for cash — no market drift). `parentTransactionId:
  // null` counts the real bank line (the split PARENT) and excludes split
  // children, matching the stored balance's convention (reconciliation.ts) — the
  // Income Statement uses children for per-category attribution, but cash flow
  // must track the bank cash line. Anticipated placeholder rows are excluded
  // (the stored balance reflects synced money only).
  const afterTxs = await prisma.transaction.findMany({
    where: { accountId: { in: liquidIds }, date: { gt: to }, isAnticipated: false, parentTransactionId: null },
    select: { amount: true, currency: true },
  });
  for (const t of afterTxs) endingCash -= await atTo(t.amount, t.currency);

  // In-period liquid transactions (same parent-only, non-anticipated scope).
  const inPeriod = await prisma.transaction.findMany({
    where: { accountId: { in: liquidIds }, date: { gte: from, lte: to }, isAnticipated: false, parentTransactionId: null },
    select: {
      amount: true, currency: true,
      isTransfer: true, transferGroupId: true, accountId: true,
    },
  });

  // Resolve partner-account kind for each transfer leg so we can classify the
  // move as investing (→investments) vs financing (→debt) vs internal.
  const groupIds = [...new Set(inPeriod.filter(t => t.isTransfer && t.transferGroupId).map(t => t.transferGroupId as string))];
  const legsByGroup = new Map<string, Array<{ accountId: string; kind: AccountKind }>>();
  if (groupIds.length > 0) {
    const allLegs = await prisma.transaction.findMany({
      where: { transferGroupId: { in: groupIds } },
      select: { transferGroupId: true, accountId: true, account: { select: { kind: true, type: true, subtype: true, name: true } } },
    });
    for (const l of allLegs) {
      if (!l.transferGroupId || !l.accountId || !l.account) continue;
      const arr = legsByGroup.get(l.transferGroupId) ?? [];
      arr.push({ accountId: l.accountId, kind: resolvedKind(l.account) });
      legsByGroup.set(l.transferGroupId, arr);
    }
  }

  let opInflows = 0, opOutflows = 0;
  let investing = 0, financing = 0, other = 0;

  for (const t of inPeriod) {
    const v = await atTo(t.amount, t.currency);
    if (!t.isTransfer) {
      if (v > 0) opInflows += v; else opOutflows += -v;
      continue;
    }
    // transfer leg on a liquid account: classify by the partner account's kind
    let partnerKind: AccountKind | null = null;
    if (t.transferGroupId) {
      const legs = legsByGroup.get(t.transferGroupId) ?? [];
      const partner = legs.find(l => l.accountId !== t.accountId);
      partnerKind = partner?.kind ?? null;
    }
    if (partnerKind && INVESTING_KINDS.includes(partnerKind)) investing += v;
    else if (partnerKind && FINANCING_KINDS.includes(partnerKind)) financing += v;
    else other += v; // liquid↔liquid (nets ~0), single-leg transfers, or misc partners
  }

  // Round each component once and derive the total from the rounded parts, so the
  // displayed activity rows always sum exactly to the net change (no sum-of-
  // rounded ≠ rounded-sum drift). Beginning is derived from the rounded ending so
  // beginning + net change = ending holds to the cent.
  const operating = { inflows: round2(opInflows), outflows: round2(opOutflows), net: round2(opInflows - opOutflows) };
  const inv = round2(investing), fin = round2(financing), oth = round2(other);
  const netChangeInCash = round2(operating.net + inv + fin + oth);
  const endingCashR = round2(endingCash);
  const beginningCash = round2(endingCashR - netChangeInCash);

  if (fxMissing > 0) notes.push(`${fxMissing} non-USD amount(s) had no FX rate and were counted at face value.`);
  notes.push('Cash basis over liquid accounts (checking, savings, wallet). Operating = income − expenses; Investing = transfers to/from investment & retirement; Financing = transfers to/from credit & loan (debt). Beginning + Net change = Ending.');

  return {
    from: ymd(from), to: ymd(to),
    baseCurrency: BASE_CURRENCY,
    operating,
    investing: { net: inv },
    financing: { net: fin },
    other: { net: oth },
    netChangeInCash,
    beginningCash,
    endingCash: endingCashR,
    notes,
  };
}

// --- combined ---------------------------------------------------------------

export async function buildStatements(opts: { from: Date; to: Date; asOf?: Date }): Promise<FinancialStatements> {
  const [balanceSheet, incomeStatement, cashFlow] = await Promise.all([
    buildBalanceSheet({ asOf: opts.asOf ?? opts.to }),
    buildIncomeStatement({ from: opts.from, to: opts.to }),
    buildCashFlowStatement({ from: opts.from, to: opts.to }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    period: { from: ymd(opts.from), to: ymd(opts.to) },
    baseCurrency: BASE_CURRENCY,
    balanceSheet, incomeStatement, cashFlow,
  };
}

/** Resolve from/to YYYY-MM-DD strings to inclusive UTC day bounds, validating. */
export function resolvePeriod(fromStr: string, toStr: string): { from: Date; to: Date } {
  const from = dayStart(fromStr);
  const to = dayEnd(toStr);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to < from) throw new Error('Invalid date range');
  return { from, to };
}

// --- CSV serialization ------------------------------------------------------

type Which = 'balance_sheet' | 'income_statement' | 'cash_flow' | 'all';

const esc = (s: string | number | null | undefined): string => {
  if (s == null) return '';
  let str = String(s);
  // Neutralize spreadsheet formula injection (CWE-1236): a leading = + @ (or
  // tab/CR), or a leading - that isn't a plain number, makes Excel/Sheets
  // evaluate the cell. Prefix an apostrophe. Legit negative amounts like
  // "-100.00" are left untouched so they still parse as numbers.
  if (/^[=+@\t\r]/.test(str) || (str[0] === '-' && !/^-?\d+(\.\d+)?$/.test(str))) {
    str = "'" + str;
  }
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};
const row = (...cells: Array<string | number | null | undefined>) => cells.map(esc).join(',');

function balanceSheetCsv(b: BalanceSheet): string {
  const L: string[] = [];
  L.push(row('Balance Sheet', `as of ${b.asOf}`, b.baseCurrency));
  L.push('');
  L.push(row('Section', 'Group', 'Account', 'Institution', 'Balance'));
  for (const g of b.assets) {
    for (const a of g.accounts) L.push(row('Assets', g.label, a.name, a.institution, a.balance.toFixed(2)));
    L.push(row('Assets', g.label, 'Subtotal', '', g.total.toFixed(2)));
  }
  L.push(row('Assets', 'TOTAL ASSETS', '', '', b.totalAssets.toFixed(2)));
  L.push('');
  for (const g of b.liabilities) {
    for (const a of g.accounts) L.push(row('Liabilities', g.label, a.name, a.institution, a.balance.toFixed(2)));
    L.push(row('Liabilities', g.label, 'Subtotal', '', g.total.toFixed(2)));
  }
  L.push(row('Liabilities', 'TOTAL LIABILITIES', '', '', b.totalLiabilities.toFixed(2)));
  L.push('');
  L.push(row('Net Worth', '', '', '', b.netWorth.toFixed(2)));
  return L.join('\r\n');
}

function incomeStatementCsv(s: IncomeStatement): string {
  const L: string[] = [];
  L.push(row('Income Statement', `${s.from} to ${s.to}`, s.baseCurrency));
  L.push('');
  L.push(row('Section', 'Category', 'Count', 'Amount'));
  for (const l of s.income) L.push(row('Income', l.bucket, l.count, l.total.toFixed(2)));
  L.push(row('Income', 'TOTAL INCOME', '', s.totalIncome.toFixed(2)));
  L.push('');
  for (const l of s.expenses) L.push(row('Expenses', l.bucket, l.count, l.total.toFixed(2)));
  L.push(row('Expenses', 'TOTAL EXPENSES', '', s.totalExpenses.toFixed(2)));
  L.push('');
  L.push(row('Net Income', '', '', s.netIncome.toFixed(2)));
  return L.join('\r\n');
}

function cashFlowCsv(c: CashFlowStatement): string {
  const L: string[] = [];
  L.push(row('Cash Flow Statement', `${c.from} to ${c.to}`, c.baseCurrency));
  L.push('');
  L.push(row('Activity', 'Detail', 'Amount'));
  L.push(row('Operating', 'Inflows', c.operating.inflows.toFixed(2)));
  L.push(row('Operating', 'Outflows', (-c.operating.outflows).toFixed(2)));
  L.push(row('Operating', 'Net operating', c.operating.net.toFixed(2)));
  L.push(row('Investing', 'Net (transfers to/from investments)', c.investing.net.toFixed(2)));
  L.push(row('Financing', 'Net (transfers to/from debt)', c.financing.net.toFixed(2)));
  L.push(row('Other', 'Net (internal / misc transfers)', c.other.net.toFixed(2)));
  L.push('');
  L.push(row('Beginning cash', '', c.beginningCash == null ? '' : c.beginningCash.toFixed(2)));
  L.push(row('Net change in cash', '', c.netChangeInCash.toFixed(2)));
  L.push(row('Ending cash', '', c.endingCash == null ? '' : c.endingCash.toFixed(2)));
  return L.join('\r\n');
}

export function statementsToCsv(s: FinancialStatements, which: Which): string {
  if (which === 'balance_sheet') return balanceSheetCsv(s.balanceSheet);
  if (which === 'income_statement') return incomeStatementCsv(s.incomeStatement);
  if (which === 'cash_flow') return cashFlowCsv(s.cashFlow);
  return [
    balanceSheetCsv(s.balanceSheet),
    '',
    incomeStatementCsv(s.incomeStatement),
    '',
    cashFlowCsv(s.cashFlow),
  ].join('\r\n');
}
