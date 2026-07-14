import { prisma } from './prisma';
import { resolvedKind, type AccountKind } from './accountKind';
import { activeFinancialSpaceId } from './spaceContext';

export type EnvelopeProgress = {
  id: string;
  monthYear: string;
  name: string;
  scope: 'tag' | 'category';
  tagId: string | null;
  categoryId: string | null;
  allocated: number;
  spent: number;
  // rolledIn: balance carried forward from the prior month (rollover envelopes
  // only; 0 otherwise). available = allocated + rolledIn - spent.
  rolledIn: number;
  available: number;
  // remaining is kept for back-compat with existing UI; it now equals
  // `available` so rollover envelopes reflect carried balance.
  remaining: number;
  pct: number;
  rollover: boolean;
  state: 'ok' | 'warn' | 'over';
  sortOrder: number;
};

function ymToRange(monthYear: string): { start: Date; end: Date } {
  const [y, m] = monthYear.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end:   new Date(Date.UTC(y, m,     1)),
  };
}

function prevMonthYear(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Build the tag-closure resolver once (parent → all descendant tag ids).
async function buildTagClosure(): Promise<(root: string) => Set<string>> {
  const allTags = await prisma.tag.findMany({ select: { id: true, parentId: true } });
  const childrenOf = new Map<string, string[]>();
  for (const t of allTags) {
    if (!t.parentId) continue;
    if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
    childrenOf.get(t.parentId)!.push(t.id);
  }
  return (root: string) => {
    const set = new Set<string>([root]);
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of childrenOf.get(cur) ?? []) {
        if (!set.has(c)) { set.add(c); stack.push(c); }
      }
    }
    return set;
  };
}

type MonthTx = { amount: number; tagIds: string[]; categoryId: string | null };

// Fetch a month's outflow transactions ONCE, memoized per monthYear for the
// lifetime of a single listEnvelopeProgress call. Avoids the N+1 explosion
// where every envelope (and every prior month in a rollover chain) re-scanned
// the whole transaction table.
function makeMonthTxLoader() {
  const cache = new Map<string, Promise<MonthTx[]>>();
  return (monthYear: string): Promise<MonthTx[]> => {
    let p = cache.get(monthYear);
    if (!p) {
      const { start, end } = ymToRange(monthYear);
      p = prisma.transaction.findMany({
        where: { date: { gte: start, lt: end }, amount: { lt: 0 }, isTransfer: false, isSplit: false },
        select: { amount: true, tags: { select: { id: true } }, categoryId: true },
      }).then(rows => rows.map(r => ({ amount: r.amount, tagIds: r.tags.map(t => t.id), categoryId: r.categoryId })));
      cache.set(monthYear, p);
    }
    return p;
  };
}

// Spend (positive number) for one envelope over its month, using the shared
// per-month transaction loader.
async function spendForEnvelope(
  e: { scope: string; tagId: string | null; categoryId: string | null; monthYear: string },
  closure: (root: string) => Set<string>,
  loadMonth: (ym: string) => Promise<MonthTx[]>,
): Promise<number> {
  const txs = await loadMonth(e.monthYear);
  const tagSet = e.scope === 'tag' && e.tagId ? closure(e.tagId) : null;
  let spent = 0;
  for (const t of txs) {
    if (e.scope === 'tag' && tagSet) {
      if (!t.tagIds.some(id => tagSet.has(id))) continue;
    } else if (e.scope === 'category' && e.categoryId) {
      if (t.categoryId !== e.categoryId) continue;
    }
    spent += Math.abs(t.amount);
  }
  return spent;
}

// How far back to walk when accumulating a rollover envelope's carried balance.
// 24 months is plenty; bounds the work for a long-lived envelope.
const MAX_ROLLOVER_LOOKBACK = 24;

// Compute the balance carried INTO `monthYear` for a rollover envelope keyed by
// name. Walks backward month-by-month: for each prior month that has an
// envelope row with the same name, available = allocated + carryFromBefore -
// spent. Positive availables carry forward; negatives also carry (overspend
// reduces next month) — matching Actual Budget's default "roll the balance"
// behavior. Stops at the first gap (no envelope row that month) or the lookback
// limit.
async function rolledInFor(
  name: string,
  monthYear: string,
  closure: (root: string) => Set<string>,
  loadMonth: (ym: string) => Promise<MonthTx[]>,
): Promise<number> {
  const spaceId = await activeFinancialSpaceId();
  // Gather the contiguous run of prior-month rows for this name, oldest first.
  const chain: Array<{ scope: string; tagId: string | null; categoryId: string | null; monthYear: string; allocated: number }> = [];
  let cursor = prevMonthYear(monthYear);
  for (let i = 0; i < MAX_ROLLOVER_LOOKBACK; i++) {
    const row = await prisma.envelope.findFirst({ where: { monthYear: cursor, name, OR: [{ spaceId }, { spaceId: null }] } });
    if (!row || !row.rollover) break; // gap or rollover turned off — chain ends
    chain.push(row);
    cursor = prevMonthYear(cursor);
  }
  chain.reverse(); // oldest → newest
  let carried = 0;
  for (const row of chain) {
    const spent = await spendForEnvelope(row, closure, loadMonth);
    carried = row.allocated + carried - spent;
  }
  return carried;
}

export async function listEnvelopeProgress(monthYear: string): Promise<EnvelopeProgress[]> {
  const envs = await prisma.envelope.findMany({
    where: { monthYear },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (!envs.length) return [];

  const closure = await buildTagClosure();
  const loadMonth = makeMonthTxLoader();

  const out: EnvelopeProgress[] = [];
  for (const e of envs) {
    const spent = await spendForEnvelope(e, closure, loadMonth);
    const rolledIn = e.rollover ? await rolledInFor(e.name, e.monthYear, closure, loadMonth) : 0;
    const available = e.allocated + rolledIn - spent;
    // pct is spend against the EFFECTIVE budget (allocated + rolledIn) so a
    // rollover envelope with banked balance shows the right fill level.
    const effective = e.allocated + rolledIn;
    const pct = effective > 0 ? spent / effective : (spent > 0 ? 1 : 0);
    const state: EnvelopeProgress['state'] = available < 0 ? 'over' : pct >= 0.85 ? 'warn' : 'ok';
    out.push({
      id: e.id,
      monthYear: e.monthYear,
      name: e.name,
      scope: e.scope as 'tag' | 'category',
      tagId: e.tagId,
      categoryId: e.categoryId,
      allocated: e.allocated,
      spent,
      rolledIn,
      available,
      remaining: available,
      pct,
      rollover: e.rollover,
      state,
      sortOrder: e.sortOrder,
    });
  }
  return out;
}

export function currentMonthYear(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Zero-based budgeting (v0.4.0) ────────────────────────────────────────────
// "Give every dollar a job." Ready-to-Assign is the spendable cash you haven't
// yet earmarked into an envelope this month. When it reaches zero, the budget
// is fully allocated (zero-based). Negative means you've assigned more than you
// hold — the UI flags it red.

// Kinds that count as spendable cash. Retirement/investment are excluded (not
// spendable without penalty/liquidation); credit/loan are liabilities.
const LIQUID_KINDS = new Set<AccountKind>(['checking', 'savings_short', 'savings_long', 'wallet']);

export type ReadyToAssign = {
  monthYear: string;
  liquid: number;     // spendable cash across liquid accounts
  assigned: number;   // Σ allocated for this month's envelopes
  readyToAssign: number; // liquid − assigned
  liquidAccounts: number;
  envelopeCount: number;
};

export async function getReadyToAssign(monthYear: string): Promise<ReadyToAssign> {
  const [accounts, envAgg, envCount] = await Promise.all([
    prisma.bankAccount.findMany({ select: { kind: true, type: true, subtype: true, name: true, balance: true } }),
    prisma.envelope.aggregate({ where: { monthYear }, _sum: { allocated: true } }),
    prisma.envelope.count({ where: { monthYear } }),
  ]);

  let liquid = 0, liquidAccounts = 0;
  for (const a of accounts) {
    if (!LIQUID_KINDS.has(resolvedKind(a))) continue;
    liquid += a.balance ?? 0;
    liquidAccounts++;
  }
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const assigned = round2(envAgg._sum.allocated ?? 0);
  liquid = round2(liquid);
  return {
    monthYear,
    liquid,
    assigned,
    readyToAssign: round2(liquid - assigned),
    liquidAccounts,
    envelopeCount: envCount,
  };
}

export type AllocationSuggestion = {
  id: string;
  name: string;
  scope: 'tag' | 'category';
  allocated: number;   // current
  suggested: number;   // trailing-average spend, rounded
  avgMonths: number;   // how many prior months had data
};

// Suggest an allocation for each envelope in `monthYear` equal to its trailing
// average spend over the prior `lookback` months (default 3). Used by the
// auto-assign affordance: "fund each envelope to what you typically spend."
// Reuses the shared tag-closure + per-month tx loader so it's a single sweep.
export async function suggestAllocations(monthYear: string, lookback = 3): Promise<AllocationSuggestion[]> {
  const envs = await prisma.envelope.findMany({ where: { monthYear }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (!envs.length) return [];

  const closure = await buildTagClosure();
  const loadMonth = makeMonthTxLoader();

  // Build the list of prior months to average.
  const months: string[] = [];
  let cursor = prevMonthYear(monthYear);
  for (let i = 0; i < lookback; i++) { months.push(cursor); cursor = prevMonthYear(cursor); }

  const out: AllocationSuggestion[] = [];
  for (const e of envs) {
    let total = 0, monthsWithData = 0;
    for (const my of months) {
      const txs = await loadMonth(my);
      if (txs.length === 0) continue; // no data that month — don't dilute the average
      const spent = await spendForEnvelope({ scope: e.scope, tagId: e.tagId, categoryId: e.categoryId, monthYear: my }, closure, loadMonth);
      total += spent;
      monthsWithData++;
    }
    const avg = monthsWithData > 0 ? total / monthsWithData : e.allocated;
    out.push({
      id: e.id,
      name: e.name,
      scope: e.scope as 'tag' | 'category',
      allocated: e.allocated,
      suggested: Math.round(avg * 100) / 100,
      avgMonths: monthsWithData,
    });
  }
  return out;
}
