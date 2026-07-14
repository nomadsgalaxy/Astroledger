import { prisma } from './prisma';
import { activeFinancialSpaceId } from './spaceContext';

type TxRow = { id: string; date: Date; amount: number; merchant: string | null; rawDescription: string };

const CADENCE_BUCKETS: Array<{ name: string; days: number; tol: number }> = [
  { name: 'weekly',    days: 7,   tol: 2 },
  { name: 'biweekly',  days: 14,  tol: 3 },
  { name: 'monthly',   days: 30,  tol: 5 },
  { name: 'quarterly', days: 91,  tol: 10 },
  { name: 'annual',    days: 365, tol: 21 },
];

function classifyCadence(avgGapDays: number) {
  for (const b of CADENCE_BUCKETS) {
    if (Math.abs(avgGapDays - b.days) <= b.tol) return b;
  }
  return null;
}

// Group amounts that are within $X or Y% of each other - handles small price changes.
function amountKey(amount: number): number {
  const a = Math.abs(amount);
  // Bucket to nearest dollar for grouping, then to nearest $0.50 above $50.
  if (a < 50) return Math.round(a);
  return Math.round(a * 2) / 2;
}

export async function detectSubscriptions(opts: { writeRecommendations?: boolean } = {}) {
  const spaceId = await activeFinancialSpaceId();
  // Pull outflows from the last 18 months - enough to catch annuals.
  const since = new Date();
  since.setMonth(since.getMonth() - 18);

  const txs = await prisma.transaction.findMany({
    where: { date: { gte: since }, amount: { lt: 0 }, isTransfer: false },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
  }) as TxRow[];

  // Group by (merchant, amount-bucket)
  const groups = new Map<string, TxRow[]>();
  for (const t of txs) {
    const m = (t.merchant || 'Unknown').trim();
    const key = `${m}::${amountKey(t.amount)}`;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  let created = 0, updated = 0;

  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;

    // Sort by date, compute gaps
    arr.sort((a, b) => +a.date - +b.date);
    const gaps: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      const g = Math.round((+arr[i].date - +arr[i - 1].date) / 86400000);
      if (g > 0) gaps.push(g);
    }
    if (gaps.length === 0) continue;

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length;
    const stdev = Math.sqrt(variance);

    const bucket = classifyCadence(avgGap);
    // Confidence: weight by (n charges, low stdev, matched bucket)
    const baseConf = Math.min(1, arr.length / 5);
    const tightness = bucket ? Math.max(0, 1 - stdev / bucket.tol) : 0;
    const matchBoost = bucket ? 0.3 : 0;
    const confidence = Math.min(1, baseConf * 0.5 + tightness * 0.5 + matchBoost);

    if (!bucket && confidence < 0.55) continue;     // too noisy to call recurring
    if (confidence < 0.45) continue;

    const [merchant] = key.split('::');
    const amount = Math.abs(arr.reduce((s, t) => s + t.amount, 0) / arr.length);
    const cadenceDays = bucket?.days ?? Math.round(avgGap);
    const cadence = bucket?.name ?? 'irregular';
    const firstSeen = arr[0].date;
    const lastSeen = arr[arr.length - 1].date;
    const nextEstimate = new Date(+lastSeen + cadenceDays * 86400000);

    // Stable upsert key matches schema @@unique([merchant, cadenceDays, amount])
    const roundedAmount = Math.round(amount * 100) / 100;
    const existing = await prisma.subscription.findUnique({
      where: { spaceId_merchant_cadenceDays_amount: { spaceId, merchant, cadenceDays, amount: roundedAmount } },
    }).catch(() => null);

    const data = {
      spaceId,
      merchant,
      amount: roundedAmount,
      cadence,
      cadenceDays,
      firstSeen,
      lastSeen,
      nextEstimate,
      confidence,
      status: existing?.status ?? 'active',
    };

    const sub = existing
      ? await prisma.subscription.update({ where: { id: existing.id }, data })
      : await prisma.subscription.create({ data });

    if (existing) updated++; else created++;

    // Link transactions to subscription
    await prisma.transaction.updateMany({
      where: { id: { in: arr.map(t => t.id) } },
      data: { subscriptionId: sub.id },
    });
  }

  return { created, updated, total: created + updated };
}
