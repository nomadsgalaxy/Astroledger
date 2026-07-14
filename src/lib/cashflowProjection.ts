import { prisma } from './prisma';
import { resolvedKind, type AccountKind } from './accountKind';

export type CashflowPoint = {
  dateISO: string;          // YYYY-MM-DD
  balance: number;          // projected total liquid cash at end-of-day
  inflow: number;
  outflow: number;
  transferIn: number;       // money moving INTO liquid cash via transfer
  transferOut: number;      // money moving OUT of liquid cash via transfer
  transferNeutral: number;  // liquid → liquid transfers (no balance impact)
  notes: string[];          // human-readable events of the day
};

export type CashflowProjection = {
  start: CashflowPoint;
  points: CashflowPoint[];  // one per day starting tomorrow
  lowWater: CashflowPoint;  // minimum balance day
  biggestOut: CashflowPoint;
  totalIn: number;
  totalOut: number;
  totalTransferred: number;
  recurringInflowsDetected: number;
  recurringTransfersDetected: number;
  // Estimated everyday/variable spending folded into the daily line so the
  // projection isn't optimistic (it used to count only bills + scheduled items).
  dailyVariableBurn: number;     // $/day of recent non-recurring, non-bill outflow
  // Freshness of the starting balance — the oldest balanceAsOf across the
  // liquid accounts. Null if no account has a timestamp.
  balanceAsOf: string | null;    // ISO date
  balanceStaleDays: number;      // days since the oldest liquid balanceAsOf (0 if unknown/fresh)
};

const LIQUID_KINDS: AccountKind[] = ['checking', 'wallet', 'savings_short', 'savings_long'];

// Project liquid cash for the next `days` days, in user's base currency.
//
// Sources:
//   - starting balance = sum of liquid asset accounts' current balances
//   - upcoming outflows = active subscriptions + anticipated outflows
//   - upcoming inflows  = detected recurring inflow streams + anticipated inflows
//   - upcoming transfers = detected recurring transfer streams (movement
//     between paired accounts), classified by net impact on liquid cash
//
// Returns daily snapshots - caller can chart `balance` over time. low-water
// + biggestOut help highlight risky days.
export async function projectCashflow(days = 90): Promise<CashflowProjection> {
  const today = startOfDayUTC(new Date());
  const horizon = new Date(+today + days * 86400000);
  const lookback = new Date(+today - 18 * 30 * 86400000);

  // Window for the "typical everyday spend" burn rate — recent enough to track
  // current habits, long enough to average out lumpiness.
  const burnWindowDays = 90;
  const burnSince = new Date(+today - burnWindowDays * 86400000);

  const [accounts, subs, schedules, anticipated, recentInflows, recentTransfers, variableOutflows] = await Promise.all([
    prisma.bankAccount.findMany({ select: { id: true, balance: true, balanceAsOf: true, type: true, kind: true } }),
    prisma.subscription.findMany({ where: { status: 'active' } }),
    prisma.schedule.findMany({ where: { active: true } }),
    prisma.transaction.findMany({
      where: { isAnticipated: true, date: { gte: today, lte: horizon } },
      include: { account: { select: { id: true, name: true, kind: true, type: true } } },
    }),
    // Paycheck-like positive inflows (not transfers).
    prisma.transaction.findMany({
      where: {
        amount: { gt: 0 },
        isTransfer: false,
        isSplit: false,
        date: { gte: lookback },
      },
      select: { id: true, merchant: true, rawDescription: true, amount: true, date: true },
    }),
    // Past transfers - both legs of each pair (transferGroupId set).
    prisma.transaction.findMany({
      where: {
        isTransfer: true,
        transferGroupId: { not: null },
        date: { gte: lookback },
      },
      select: {
        id: true, amount: true, date: true, accountId: true, transferGroupId: true,
        merchant: true, rawDescription: true,
        account: { select: { id: true, name: true, kind: true, type: true } },
      },
    }),
    // Everyday variable spend: recent outflows that AREN'T already modeled as a
    // subscription, transfer, or anticipated row. isSplit:false counts split
    // children + normal rows (parents excluded) so split charges aren't doubled.
    prisma.transaction.findMany({
      where: {
        amount: { lt: 0 },
        isTransfer: false,
        isSplit: false,
        subscriptionId: null,
        isAnticipated: false,
        date: { gte: burnSince, lte: today },
      },
      select: { amount: true, merchant: true },
    }),
  ]);

  // Index accounts and detect which are liquid.
  const acctById = new Map(accounts.map(a => [a.id, a]));
  const isLiquid = (a: { kind: string | null; type: string }) => LIQUID_KINDS.includes(resolvedKind(a) as any);
  const liquidAccounts = accounts.filter(a => isLiquid(a));
  const startBalance = liquidAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  // Freshness of the start balance = oldest balanceAsOf across liquid accounts.
  const asOfs = liquidAccounts.map(a => a.balanceAsOf).filter((d): d is Date => d != null);
  const oldestAsOf = asOfs.length ? asOfs.reduce((a, b) => (a < b ? a : b)) : null;
  const balanceStaleDays = oldestAsOf ? Math.max(0, Math.floor((+today - +startOfDayUTC(oldestAsOf)) / 86400000)) : 0;

  // Everyday variable spend, spread evenly across the horizon. Counting only
  // recent non-bill, non-transfer outflows keeps it from double-counting the
  // subscriptions/anticipated rows already projected below. Also exclude rows
  // whose merchant matches an active subscription — catches recurring bills
  // whose transactions weren't back-linked via subscriptionId.
  const subMerchants = new Set(subs.map(s => (s.merchant ?? '').toLowerCase().trim()).filter(Boolean));
  const variableTotal = variableOutflows
    .filter(t => !subMerchants.has((t.merchant ?? '').toLowerCase().trim()))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const dailyVariableBurn = Math.round((variableTotal / burnWindowDays) * 100) / 100;

  // Empty daily buckets [tomorrow .. today+days].
  const buckets: CashflowPoint[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(+today + i * 86400000);
    buckets.push({
      dateISO: d.toISOString().slice(0, 10), balance: 0,
      inflow: 0, outflow: 0,
      transferIn: 0, transferOut: 0, transferNeutral: 0,
      notes: [],
    });
  }

  function bucketFor(date: Date): CashflowPoint | null {
    const idx = Math.round((+startOfDayUTC(date) - +today) / 86400000) - 1;
    if (idx < 0 || idx >= buckets.length) return null;
    return buckets[idx];
  }

  // 1. Active subscriptions → outflows at cadenceDays spacing.
  for (const s of subs) {
    if (!s.nextEstimate) continue;
    let when = s.nextEstimate;
    let safety = 0;
    while (when <= horizon && safety++ < 60) {
      const b = bucketFor(when);
      if (b) {
        b.outflow += Math.abs(s.amount);
        b.notes.push(`${s.merchant} (${s.cadence})`);
      }
      when = new Date(+when + Math.max(1, s.cadenceDays) * 86400000);
    }
  }

  // 1b. Manual recurring Schedule entries (v0.5.0): signed amount, stepped at
  //     cadenceDays from nextDate. Positive = inflow (a manually-tracked
  //     paycheck), negative = outflow (rent, quarterly tax).
  for (const s of schedules) {
    let when = s.nextDate;
    let safety = 0;
    while (when <= horizon && safety++ < 366) {
      const b = bucketFor(when);
      if (b) {
        if (s.amount >= 0) { b.inflow += s.amount; b.notes.push(`+${s.name}`); }
        else { b.outflow += Math.abs(s.amount); b.notes.push(`–${s.name}`); }
      }
      when = new Date(+when + Math.max(1, s.cadenceDays) * 86400000);
    }
  }

  // 2. Anticipated transactions land on their `date`. If the anticipated
  //    row is itself a transfer, treat it as a transfer (we still don't
  //    know the counter-leg, so classify by the account's liquidity).
  for (const t of anticipated) {
    const b = bucketFor(t.date);
    if (!b) continue;
    if (t.amount > 0) { b.inflow += t.amount; b.notes.push(`+${t.merchant ?? t.rawDescription}`); }
    else              { b.outflow += Math.abs(t.amount); b.notes.push(`–${t.merchant ?? t.rawDescription}`); }
  }

  // 3. Detect recurring inflows (paycheck-style).
  type Stream = { key: string; lastDate: Date; periodDays: number; avgAmount: number };
  const positives = groupBy(recentInflows, t => (t.merchant ?? t.rawDescription).trim());
  const inflowStreams = detectStreams(positives, t => t.amount);
  for (const h of inflowStreams) {
    let when = new Date(+h.lastDate + h.periodDays * 86400000);
    let safety = 0;
    while (when <= horizon && safety++ < 60) {
      const b = bucketFor(when);
      if (b) {
        b.inflow += h.avgAmount;
        b.notes.push(`+${h.key} (~${h.periodDays}d)`);
      }
      when = new Date(+when + h.periodDays * 86400000);
    }
  }

  // 4. Detect recurring TRANSFER streams. A "transfer" in Astroledger is a pair
  //    of rows sharing transferGroupId - one debit, one credit, on
  //    different accounts. We collapse paired legs into a single logical
  //    move keyed by (fromKind, toKind, ±amount-bucket) so e.g. weekly
  //    "checking → savings" gets recognized as one stream regardless of
  //    which leg's description varies.
  const pairs = collapseTransferPairs(recentTransfers, acctById);
  const transferGroups = groupBy(pairs, p => p.streamKey);
  const transferStreams = detectStreams(transferGroups, t => t.amount, { allowNegative: false });
  for (const h of transferStreams) {
    // Recover from/to kind via the latest pair in the group.
    const sample = transferGroups.get(h.key)!.at(-1)!;
    let when = new Date(+h.lastDate + h.periodDays * 86400000);
    let safety = 0;
    while (when <= horizon && safety++ < 60) {
      const b = bucketFor(when);
      if (b) {
        const note = `↔ ${sample.fromName} → ${sample.toName} ($${h.avgAmount.toFixed(0)})`;
        if (sample.fromLiquid && sample.toLiquid) {
          b.transferNeutral += h.avgAmount;
          b.notes.push(note);
        } else if (sample.fromLiquid && !sample.toLiquid) {
          b.transferOut += h.avgAmount;
          b.notes.push(note);
        } else if (!sample.fromLiquid && sample.toLiquid) {
          b.transferIn += h.avgAmount;
          b.notes.push(note);
        }
      }
      when = new Date(+when + h.periodDays * 86400000);
    }
  }

  // 5. Fold in the estimated everyday spend (one day's burn per bucket) so the
  //    projection reflects real spending, not just bills. Tagged on the first
  //    day only to keep the notes uncluttered.
  if (dailyVariableBurn > 0) {
    for (let i = 0; i < buckets.length; i++) {
      buckets[i].outflow += dailyVariableBurn;
      if (i === 0) buckets[i].notes.push(`~${dailyVariableBurn.toFixed(0)}/day typical spending`);
    }
  }

  // 6. Roll running balance. transferNeutral does NOT shift the balance
  //    (both legs land in liquid cash); transferIn/Out do.
  let running = startBalance;
  for (const b of buckets) {
    running += b.inflow + b.transferIn - b.outflow - b.transferOut;
    b.balance = running;
  }

  const fallback: CashflowPoint = {
    dateISO: today.toISOString().slice(0, 10), balance: startBalance,
    inflow: 0, outflow: 0, transferIn: 0, transferOut: 0, transferNeutral: 0, notes: [],
  };
  const lowWater = buckets.reduce((min, p) => p.balance < min.balance ? p : min, buckets[0] ?? fallback);
  const biggestOut = buckets.reduce((max, p) => p.outflow > max.outflow ? p : max, buckets[0] ?? fallback);

  return {
    start: fallback,
    points: buckets,
    lowWater,
    biggestOut,
    totalIn: buckets.reduce((s, b) => s + b.inflow + b.transferIn, 0),
    totalOut: buckets.reduce((s, b) => s + b.outflow + b.transferOut, 0),
    totalTransferred: buckets.reduce((s, b) => s + b.transferIn + b.transferOut + b.transferNeutral, 0),
    recurringInflowsDetected: inflowStreams.length,
    recurringTransfersDetected: transferStreams.length,
    dailyVariableBurn,
    balanceAsOf: oldestAsOf ? oldestAsOf.toISOString().slice(0, 10) : null,
    balanceStaleDays,
  };
}

// ---------- internals ----------

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) {
    const k = keyFn(t);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(t);
  }
  return out;
}

// Period heuristics shared by paycheck + transfer detection.
function detectStreams<T extends { amount: number; date: Date }>(
  groups: Map<string, T[]>,
  amount: (t: T) => number,
  opts: { allowNegative?: boolean } = {},
): Array<{ key: string; lastDate: Date; periodDays: number; avgAmount: number }> {
  const out: Array<{ key: string; lastDate: Date; periodDays: number; avgAmount: number }> = [];
  const candidates = [7, 14, 15, 30, 31];
  for (const [key, txs] of groups) {
    if (txs.length < 3) continue;
    const sorted = [...txs].sort((a, b) => +a.date - +b.date);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push((+sorted[i].date - +sorted[i - 1].date) / 86400000);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const period = candidates.find(p => Math.abs(avgGap - p) <= p * 0.25);
    if (!period) continue;
    const amounts = sorted.map(t => Math.abs(amount(t)));
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (!opts.allowNegative && mean <= 0) continue;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    if (cv > 0.4) continue;
    out.push({ key, lastDate: sorted[sorted.length - 1].date, periodDays: period, avgAmount: mean });
  }
  return out;
}

// Collapse a list of transfer legs (paired by transferGroupId) into one row
// per pair, keyed by (fromAccountId, toAccountId) so recurring movements
// between the same two accounts cluster correctly.
type TransferPair = {
  amount: number;          // magnitude of the move
  date: Date;
  fromAccountId: string; toAccountId: string;
  fromName: string;        toName: string;
  fromLiquid: boolean;     toLiquid: boolean;
  streamKey: string;       // (fromId, toId)
};
function collapseTransferPairs(
  legs: Array<{
    id: string; amount: number; date: Date; accountId: string;
    transferGroupId: string | null;
    account: { id: string; name: string; kind: string | null; type: string };
  }>,
  acctById: Map<string, { id: string; balance: number | null; type: string; kind: string | null }>,
): TransferPair[] {
  const byGroup = new Map<string, typeof legs>();
  for (const l of legs) {
    if (!l.transferGroupId) continue;
    if (!byGroup.has(l.transferGroupId)) byGroup.set(l.transferGroupId, []);
    byGroup.get(l.transferGroupId)!.push(l);
  }
  const out: TransferPair[] = [];
  for (const [, legs] of byGroup) {
    if (legs.length !== 2) continue;  // single-leg "transfers" don't help here
    const debit  = legs.find(l => l.amount < 0);
    const credit = legs.find(l => l.amount > 0);
    if (!debit || !credit) continue;
    const fromAcct = acctById.get(debit.accountId) ?? { kind: debit.account.kind, type: debit.account.type } as any;
    const toAcct   = acctById.get(credit.accountId) ?? { kind: credit.account.kind, type: credit.account.type } as any;
    out.push({
      amount: Math.abs(debit.amount),
      date: debit.date,
      fromAccountId: debit.accountId,
      toAccountId:   credit.accountId,
      fromName: debit.account.name,
      toName:   credit.account.name,
      fromLiquid: LIQUID_KINDS.includes(resolvedKind(fromAcct) as any),
      toLiquid:   LIQUID_KINDS.includes(resolvedKind(toAcct)   as any),
      streamKey: `${debit.accountId}→${credit.accountId}`,
    });
  }
  return out;
}
