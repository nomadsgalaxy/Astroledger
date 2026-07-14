import { prisma } from './prisma';

// Build savings recommendations from current state.
// Idempotent-ish: clears open recommendations of each kind first, then re-creates.

const KINDS = ['duplicate_sub', 'unused_sub', 'price_hike', 'over_avg', 'new_recurring'] as const;

export async function buildRecommendations() {
  // Clear prior open recs (keep dismissed/done so they don't come back)
  await prisma.recommendation.deleteMany({
    where: { status: 'open', kind: { in: KINDS as unknown as string[] } },
  });

  const recs: Array<Parameters<typeof prisma.recommendation.create>[0]['data']> = [];
  const subs = await prisma.subscription.findMany({
    where: { status: 'active' },
    include: { transactions: { orderBy: { date: 'desc' }, take: 1 } },
  });

  // 1) Duplicate subscriptions (same category-ish merchant, e.g. multiple streaming)
  const streamingKeywords = /(netflix|hulu|disney|hbo|max|paramount|peacock|apple\s*tv|youtube\s*premium|youtube\s*tv|spotify|tidal|apple\s*music)/i;
  const streamingSubs = subs.filter(s => streamingKeywords.test(s.merchant));
  if (streamingSubs.length >= 3) {
    const monthly = streamingSubs.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.cadenceDays), 0);
    const cheapest = [...streamingSubs].sort((a, b) =>
      monthlyEquivalent(a.amount, a.cadenceDays) - monthlyEquivalent(b.amount, b.cadenceDays))[0];
    const savings = monthly - monthlyEquivalent(cheapest.amount, cheapest.cadenceDays) * 2;
    recs.push({
      kind: 'duplicate_sub',
      title: `You have ${streamingSubs.length} streaming subscriptions`,
      detail: `Active: ${streamingSubs.map(s => s.merchant).join(', ')}. Rotating to 1–2 at a time could save roughly $${savings.toFixed(0)}/mo.`,
      monthlySavings: Math.max(0, savings),
      refType: 'subscription',
    });
  }

  // 2) Unused since 90+ days (lastSeen old but still 'active')
  const now = Date.now();
  for (const s of subs) {
    const days = Math.round((now - +s.lastSeen) / 86400000);
    if (days > 90 && s.cadenceDays <= 60) {
      recs.push({
        kind: 'unused_sub',
        title: `${s.merchant} - no charge in ${days} days`,
        detail: `Expected to bill every ~${s.cadenceDays} days but hasn't charged. Verify it's still active or cancel.`,
        monthlySavings: monthlyEquivalent(s.amount, s.cadenceDays),
        refType: 'subscription', refId: s.id,
      });
    }
  }

  // 3) Price hike: latest charge > 15% above median
  for (const s of subs) {
    const charges = await prisma.transaction.findMany({
      where: { subscriptionId: s.id }, orderBy: { date: 'asc' },
      select: { amount: true, date: true },
    });
    if (charges.length < 4) continue;
    const amounts = charges.map(c => Math.abs(c.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const latest = Math.abs(charges[charges.length - 1].amount);
    if (latest > median * 1.15 && latest - median > 1) {
      recs.push({
        kind: 'price_hike',
        title: `${s.merchant} raised its price`,
        detail: `Latest charge $${latest.toFixed(2)} vs typical $${median.toFixed(2)} (+${(((latest - median) / median) * 100).toFixed(0)}%).`,
        monthlySavings: 0,
        refType: 'subscription', refId: s.id,
      });
    }
  }

  // 4) Above-avg merchants in a category (last 90 days)
  const since = new Date(); since.setDate(since.getDate() - 90);
  const tx = await prisma.transaction.findMany({
    where: { date: { gte: since }, amount: { lt: 0 }, isTransfer: false, NOT: { subscriptionId: null } as any },
    include: { category: true },
  });
  // Aggregate by category → merchant
  const catMerchTotals = new Map<string, Map<string, number>>();
  for (const t of tx) {
    const cat = t.category?.name ?? 'Other';
    const m = t.merchant ?? 'Unknown';
    if (!catMerchTotals.has(cat)) catMerchTotals.set(cat, new Map());
    const inner = catMerchTotals.get(cat)!;
    inner.set(m, (inner.get(m) ?? 0) + Math.abs(t.amount));
  }
  for (const [cat, inner] of catMerchTotals) {
    const totals = [...inner.values()];
    if (totals.length < 3) continue;
    const avg = totals.reduce((s, n) => s + n, 0) / totals.length;
    for (const [m, total] of inner) {
      if (total > avg * 2 && total > 100) {
        recs.push({
          kind: 'over_avg',
          title: `Heavy spend on ${m}`,
          detail: `Past 90d: $${total.toFixed(0)} on ${m} - ~${(total / avg).toFixed(1)}× your average ${cat} merchant.`,
          monthlySavings: Math.max(0, (total - avg) / 3),
          refType: 'merchant',
        });
      }
    }
  }

  // 5) New recurring (subscription seen in last 60 days, first time)
  const recentSubs = subs.filter(s => +s.firstSeen > now - 60 * 86400000);
  for (const s of recentSubs) {
    recs.push({
      kind: 'new_recurring',
      title: `New recurring charge: ${s.merchant}`,
      detail: `First charged ${s.firstSeen.toISOString().slice(0, 10)} at $${s.amount.toFixed(2)} every ~${s.cadenceDays} days.`,
      monthlySavings: 0,
      refType: 'subscription', refId: s.id,
    });
  }

  for (const r of recs) await prisma.recommendation.create({ data: r });
  return recs.length;
}

export function monthlyEquivalent(amount: number, cadenceDays: number): number {
  return amount * (30 / Math.max(1, cadenceDays));
}
