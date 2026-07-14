import { prisma } from './prisma';
import { activeFinancialSpaceId } from './spaceContext';

const DAY = 86_400_000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type BillSourceType = 'subscription' | 'schedule' | 'anticipated';
export type BillStoredStatus = 'upcoming' | 'paid' | 'skipped';
export type BillDisplayStatus = BillStoredStatus | 'overdue';

export type BillCandidate = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  account: string;
  score: number;
};

export type BillOccurrenceView = {
  id: string;
  sourceType: BillSourceType;
  sourceId: string;
  name: string;
  dueDate: string;
  expectedAmount: number;
  amountMode: 'fixed' | 'variable';
  autopay: boolean;
  status: BillDisplayStatus;
  storedStatus: BillStoredStatus;
  paidAt: string | null;
  transaction: BillCandidate | null;
  candidates: BillCandidate[];
};

export type BillDashboard = {
  occurrences: BillOccurrenceView[];
  summary: {
    expected: number;
    dueSoon: number;
    overdue: number;
    overdueCount: number;
    paid: number;
    paidCount: number;
  };
};

type CandidateInput = {
  id: string;
  date: Date;
  amount: number;
  merchant: string | null;
  rawDescription: string;
  subscriptionId: string | null;
  mergedFromAnticipated: string | null;
  account: { name: string; mask: string | null };
};

type BillMatchInput = {
  sourceType: string;
  sourceId: string;
  name: string;
  dueDate: Date;
  expectedAmount: number;
  amountMode: string;
};

export function projectOccurrenceDates(start: Date, cadenceDays: number, from: Date, until: Date): Date[] {
  const out: Date[] = [];
  const step = Math.max(1, Math.round(cadenceDays)) * DAY;
  let when = start.getTime();
  while (when < from.getTime()) when += step;
  let safety = 0;
  while (when <= until.getTime() && safety++ < 200) {
    out.push(new Date(when));
    when += step;
  }
  return out;
}

function normalizedWords(value: string): string[] {
  const ignored = new Set(['the', 'and', 'payment', 'bill', 'online', 'autopay', 'company', 'co', 'inc', 'llc']);
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 1 && !ignored.has(w));
}

export function billCandidateScore(bill: BillMatchInput, tx: CandidateInput): number {
  if (tx.amount >= 0) return 0;
  const dayDiff = Math.abs(tx.date.getTime() - bill.dueDate.getTime()) / DAY;
  if (dayDiff > 14) return 0;

  if (bill.sourceType === 'subscription' && tx.subscriptionId === bill.sourceId) return 100;
  if (bill.sourceType === 'anticipated' && tx.mergedFromAnticipated === bill.sourceId) return 100;

  const billWords = normalizedWords(bill.name);
  const txText = `${tx.merchant ?? ''} ${tx.rawDescription}`;
  const txWords = new Set(normalizedWords(txText));
  const overlap = billWords.filter(w => txWords.has(w)).length;
  const nameRatio = billWords.length ? overlap / billWords.length : 0;
  if (nameRatio === 0) return 0;

  const actual = Math.abs(tx.amount);
  const amountDiff = Math.abs(actual - bill.expectedAmount);
  const amountRatio = bill.expectedAmount > 0 ? amountDiff / bill.expectedAmount : 1;
  const tolerance = bill.amountMode === 'variable' ? 1 : 0.35;
  if (amountRatio > tolerance) return 0;

  const nameScore = nameRatio >= 1 ? 45 : nameRatio >= 0.5 ? 34 : 24;
  const dateScore = Math.max(0, 35 - dayDiff * 3);
  const amountScore = Math.max(0, 20 - (amountRatio / Math.max(tolerance, 0.01)) * 20);
  return Math.round(nameScore + dateScore + amountScore);
}

function candidateView(tx: CandidateInput, score: number): BillCandidate {
  return {
    id: tx.id,
    date: tx.date.toISOString().slice(0, 10),
    merchant: tx.merchant ?? tx.rawDescription.slice(0, 60),
    amount: Math.abs(tx.amount),
    account: `${tx.account.name}${tx.account.mask ? ` · ${tx.account.mask}` : ''}`,
    score,
  };
}

export async function getBillDashboard(now = new Date(), futureDays = 60, pastDays = 35): Promise<BillDashboard> {
  const spaceId = await activeFinancialSpaceId();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(today.getTime() - pastDays * DAY);
  const until = new Date(today.getTime() + futureDays * DAY);

  const [subscriptions, schedules, anticipated] = await Promise.all([
    prisma.subscription.findMany({
      // A detected subscription owns one authoritative next estimate. Projecting
      // its cadence ourselves creates false historical debt when detection is
      // stale; the detector advances nextEstimate when a new charge lands.
      where: { status: 'active', nextEstimate: { gte: today, lte: until } },
      select: { id: true, merchant: true, amount: true, amountMode: true, autopay: true, cadenceDays: true, nextEstimate: true },
    }),
    prisma.schedule.findMany({
      where: { active: true, amount: { lt: 0 } },
      select: { id: true, name: true, amount: true, amountMode: true, autopay: true, cadenceDays: true, nextDate: true },
    }),
    prisma.transaction.findMany({
      where: { isAnticipated: true, amount: { lt: 0 }, date: { gte: from, lte: until } },
      select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
    }),
  ]);

  const seeds: Array<{
    sourceType: BillSourceType;
    sourceId: string;
    name: string;
    dueDate: Date;
    expectedAmount: number;
    amountMode: string;
    autopay: boolean;
  }> = [];

  for (const source of subscriptions) {
    seeds.push({ sourceType: 'subscription', sourceId: source.id, name: source.merchant, dueDate: source.nextEstimate!, expectedAmount: Math.abs(source.amount), amountMode: source.amountMode, autopay: source.autopay });
  }
  for (const source of schedules) {
    // Manual schedules are intentional obligations. Retain at most one missed
    // occurrence when nextDate is stale, then project normally into the future.
    const scheduleFrom = new Date(Math.max(from.getTime(), today.getTime() - Math.max(1, source.cadenceDays) * DAY));
    for (const dueDate of projectOccurrenceDates(source.nextDate, source.cadenceDays, scheduleFrom, until)) {
      seeds.push({ sourceType: 'schedule', sourceId: source.id, name: source.name, dueDate, expectedAmount: Math.abs(source.amount), amountMode: source.amountMode, autopay: source.autopay });
    }
  }
  for (const source of anticipated) {
    seeds.push({ sourceType: 'anticipated', sourceId: source.id, name: source.merchant ?? source.rawDescription.slice(0, 60), dueDate: source.date, expectedAmount: Math.abs(source.amount), amountMode: 'fixed', autopay: false });
  }

  if (seeds.length) {
    await prisma.$transaction(async tx => {
      for (const seed of seeds) {
        await tx.billOccurrence.upsert({
          where: { spaceId_sourceType_sourceId_dueDate: { spaceId, sourceType: seed.sourceType, sourceId: seed.sourceId, dueDate: seed.dueDate } },
          create: { ...seed, spaceId },
          update: { name: seed.name, amountMode: seed.amountMode, autopay: seed.autopay },
        });
      }
    });
  }

  let occurrences = await prisma.billOccurrence.findMany({
    where: { dueDate: { gte: from, lte: until } },
    include: { transaction: { include: { account: { select: { name: true, mask: true } } } } },
    orderBy: { dueDate: 'asc' },
  });

  const transactions = await prisma.transaction.findMany({
    where: {
      amount: { lt: 0 }, isAnticipated: false, parentTransactionId: null,
      date: { gte: new Date(from.getTime() - 14 * DAY), lte: now },
    },
    include: { account: { select: { name: true, mask: true } } },
    orderBy: { date: 'desc' },
    take: 1200,
  }) as CandidateInput[];

  const claimed = new Set(occurrences.map(o => o.transactionId).filter(Boolean) as string[]);
  const autoMatches: Array<{ occurrenceId: string; tx: CandidateInput }> = [];
  for (const occurrence of occurrences) {
    if (occurrence.status !== 'upcoming' || occurrence.transactionId || occurrence.dueDate.getTime() > now.getTime() + 7 * DAY) continue;
    const ranked = transactions
      .filter(tx => !claimed.has(tx.id))
      .map(tx => ({ tx, score: billCandidateScore(occurrence, tx) }))
      .filter(x => x.score >= 82)
      .sort((a, b) => b.score - a.score);
    if (ranked[0]) {
      claimed.add(ranked[0].tx.id);
      autoMatches.push({ occurrenceId: occurrence.id, tx: ranked[0].tx });
    }
  }
  if (autoMatches.length) {
    await prisma.$transaction(async tx => {
      for (const match of autoMatches) {
        await tx.billOccurrence.update({
          where: { id: match.occurrenceId },
          data: { status: 'paid', transactionId: match.tx.id, paidAt: match.tx.date },
        });
      }
    });
    occurrences = await prisma.billOccurrence.findMany({
      where: { dueDate: { gte: from, lte: until } },
      include: { transaction: { include: { account: { select: { name: true, mask: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  const views: BillOccurrenceView[] = occurrences.map(occurrence => {
    const candidates = occurrence.status === 'upcoming'
      ? transactions
        .filter(tx => !claimed.has(tx.id))
        .map(tx => ({ tx, score: billCandidateScore(occurrence, tx) }))
        .filter(x => x.score >= 45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(x => candidateView(x.tx, x.score))
      : [];
    const storedStatus = occurrence.status as BillStoredStatus;
    const status: BillDisplayStatus = storedStatus === 'upcoming' && occurrence.dueDate.getTime() < today.getTime()
      ? 'overdue'
      : storedStatus;
    const linked = occurrence.transaction as CandidateInput | null;
    return {
      id: occurrence.id,
      sourceType: occurrence.sourceType as BillSourceType,
      sourceId: occurrence.sourceId,
      name: occurrence.name,
      dueDate: occurrence.dueDate.toISOString().slice(0, 10),
      expectedAmount: occurrence.expectedAmount,
      amountMode: occurrence.amountMode as 'fixed' | 'variable',
      autopay: occurrence.autopay,
      status,
      storedStatus,
      paidAt: occurrence.paidAt?.toISOString() ?? null,
      transaction: linked ? candidateView(linked, 100) : null,
      candidates,
    };
  });

  const active = views.filter(v => v.status !== 'skipped');
  const dueSoonUntil = today.getTime() + 7 * DAY;
  return {
    occurrences: views,
    summary: {
      expected: round2(active.filter(v => v.status === 'upcoming' || v.status === 'overdue').reduce((sum, v) => sum + v.expectedAmount, 0)),
      dueSoon: round2(active.filter(v => v.status === 'upcoming' && new Date(v.dueDate).getTime() <= dueSoonUntil).reduce((sum, v) => sum + v.expectedAmount, 0)),
      overdue: round2(active.filter(v => v.status === 'overdue').reduce((sum, v) => sum + v.expectedAmount, 0)),
      overdueCount: active.filter(v => v.status === 'overdue').length,
      paid: round2(active.filter(v => v.status === 'paid').reduce((sum, v) => sum + (v.transaction?.amount ?? v.expectedAmount), 0)),
      paidCount: active.filter(v => v.status === 'paid').length,
    },
  };
}
