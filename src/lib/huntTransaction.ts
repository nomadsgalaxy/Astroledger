import { prisma } from './prisma';
import { chat, llmAvailable } from './llm';

export type HuntResult = {
  source: {
    id: string;
    date: string;
    amount: number;
    merchant: string;
    rawDescription: string;
    account: string;
  };
  relatedTransactions: Array<{
    id: string;
    date: string;
    amount: number;
    merchant: string;
    account: string;
  }>;
  recurrenceHint: {
    count: number;
    firstSeen: string | null;
    lastSeen: string | null;
    totalSpent: number;        // sum of |amount| across all related outflows
    avgDaysBetween: number | null;
    suspectedSubscription: boolean;
    matchingSubscription: { id: string; merchant: string; cadence: string; amount: number } | null;
  };
  matchingOrders: Array<{
    id: string;
    source: string;
    orderDate: string;
    merchant: string;
    amount: number;
    snippet: string | null;
    url: string | null;
  }>;
  searchTokens: string[];
  llm: {
    available: boolean;
    summary: string | null;
    cancelSteps: string[];
    likelyService: string | null;
  };
};

/**
 * Extract searchable tokens from a credit-card descriptor.
 * Drops payment-processor prefixes like "WP*", "SQ*", "TST*", "PYP*", etc.
 * Returns lowercased word fragments that are likely to appear in receipts.
 */
function tokenize(raw: string): string[] {
  const cleaned = raw
    // Strip common processor prefixes
    .replace(/^(WP|SQ|SP|TST|PYP|PAYPAL|SQR|VENMO|TS|EBL|DD|UB|EVE|EZ|GG|UB|PRE)\*/i, '')
    // Strip trailing state codes like "Boise ID"
    .replace(/\s+[A-Z]{2}\s*$/, '')
    // Strip trailing phone numbers like "800-433-7300 TX"
    .replace(/\s+\d{3}-\d{3,4}-\d{4}.*$/, '')
    .replace(/[*#@]/g, ' ')
    .toLowerCase();
  // Keep words ≥3 chars (drops stopwords like "to", "of"), dedupe
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of cleaned.split(/\s+/)) {
    const w = word.replace(/[^a-z0-9]/g, '');
    if (w.length >= 3 && !seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out.slice(0, 6);
}

export async function huntTransaction(txId: string): Promise<HuntResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { account: { include: { institution: true } }, subscription: true },
  });
  if (!tx) throw new Error('Transaction not found');

  const merchant = tx.merchant ?? tx.rawDescription;
  const tokens = tokenize(tx.rawDescription);

  // 1) Related transactions - same normalized merchant.
  const related = await prisma.transaction.findMany({
    where: { merchant, id: { not: tx.id } },
    select: { id: true, date: true, amount: true, merchant: true, account: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  // Recurrence stats
  const sameMerchantOutflows = [...related, { id: tx.id, date: tx.date, amount: tx.amount, merchant }]
    .filter(t => t.amount < 0)
    .sort((a, b) => +a.date - +b.date);
  const totalSpent = sameMerchantOutflows.reduce((s, t) => s + Math.abs(t.amount), 0);
  let avgDaysBetween: number | null = null;
  if (sameMerchantOutflows.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sameMerchantOutflows.length; i++) {
      const g = Math.round((+sameMerchantOutflows[i].date - +sameMerchantOutflows[i - 1].date) / 86400000);
      if (g > 0) gaps.push(g);
    }
    if (gaps.length) avgDaysBetween = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  }
  const suspectedSubscription = (
    sameMerchantOutflows.length >= 3
    && avgDaysBetween !== null
    && avgDaysBetween >= 20 && avgDaysBetween <= 40
  );

  // 2) Order matches. Search by tokens against `merchant` and `raw` fields.
  const orderConditions = tokens.flatMap(t => [
    { merchant: { contains: t } },
    { raw: { contains: t } },
  ]);
  const orders = orderConditions.length > 0
    ? await prisma.order.findMany({
        where: { OR: orderConditions },
        orderBy: { orderDate: 'desc' },
        take: 20,
      })
    : [];

  // 3) LLM analysis - short and bounded
  const llm = await analyzeWithLLM({
    rawDescription: tx.rawDescription,
    merchant,
    amount: tx.amount,
    relatedCount: sameMerchantOutflows.length,
    avgDaysBetween,
    totalSpent,
    orderSnippets: orders.slice(0, 3).map(o => ({
      merchant: o.merchant,
      snippet: (o.raw ?? '').replace(/\s+/g, ' ').slice(0, 400),
    })),
  });

  return {
    source: {
      id: tx.id,
      date: tx.date.toISOString(),
      amount: tx.amount,
      merchant,
      rawDescription: tx.rawDescription,
      account: `${tx.account.institution.name} · ${tx.account.name}`,
    },
    relatedTransactions: related.map(r => ({
      id: r.id, date: r.date.toISOString(), amount: r.amount,
      merchant: r.merchant ?? '', account: r.account.name,
    })),
    recurrenceHint: {
      count: sameMerchantOutflows.length,
      firstSeen: sameMerchantOutflows[0]?.date.toISOString() ?? null,
      lastSeen: sameMerchantOutflows[sameMerchantOutflows.length - 1]?.date.toISOString() ?? null,
      totalSpent,
      avgDaysBetween,
      suspectedSubscription,
      matchingSubscription: tx.subscription
        ? { id: tx.subscription.id, merchant: tx.subscription.merchant, cadence: tx.subscription.cadence, amount: tx.subscription.amount }
        : null,
    },
    matchingOrders: orders.map(o => ({
      id: o.id, source: o.source, orderDate: o.orderDate.toISOString(),
      merchant: o.merchant, amount: o.amount,
      snippet: o.raw ? o.raw.replace(/\s+/g, ' ').slice(0, 240) : null,
      url: o.url,
    })),
    searchTokens: tokens,
    llm,
  };
}

async function analyzeWithLLM(ctx: {
  rawDescription: string;
  merchant: string;
  amount: number;
  relatedCount: number;
  avgDaysBetween: number | null;
  totalSpent: number;
  orderSnippets: Array<{ merchant: string; snippet: string }>;
}): Promise<HuntResult['llm']> {
  const available = await llmAvailable();
  if (!available) return { available: false, summary: null, cancelSteps: [], likelyService: null };

  const sys = [
    'You help users identify mystery charges on their bank statements and explain how to cancel subscriptions.',
    'Return STRICT JSON only.',
    'Schema: {"likelyService":"<best guess at the real company/service name>","summary":"<2-3 sentence plain-English explanation>","cancelSteps":["step 1","step 2","step 3"]}',
    'Rules:',
    '- likelyService should be the actual service the user signed up for (e.g. "Crunchyroll", "Patreon: Specific Creator"), not the credit-card descriptor.',
    '- cancelSteps should be ACTIONABLE (URLs, account paths, support phone numbers) - short bullet points.',
    '- If you genuinely cannot tell what this is, say so in summary and leave cancelSteps empty.',
    '- Do NOT invent details. If receipts are missing, base it on the descriptor.',
  ].join('\n');

  const evidence = [
    `Card descriptor: "${ctx.rawDescription}"`,
    `Normalized merchant: "${ctx.merchant}"`,
    `Latest amount: $${Math.abs(ctx.amount).toFixed(2)}`,
    `Times charged: ${ctx.relatedCount}`,
    ctx.avgDaysBetween !== null ? `Avg days between charges: ${ctx.avgDaysBetween}` : 'Charges: one-off',
    `Lifetime spent: $${ctx.totalSpent.toFixed(2)}`,
    ctx.orderSnippets.length > 0
      ? 'Matching receipts / orders:\n' + ctx.orderSnippets.map(o => ` - from ${o.merchant}: "${o.snippet}"`).join('\n')
      : 'Matching receipts: none in inbox',
  ].join('\n');

  try {
    const res = await chat([
      { role: 'system', content: sys },
      { role: 'user',   content: 'Identify this charge and give cancel steps if it looks like a subscription.\n\n' + evidence },
    ], { responseFormat: 'json_object', temperature: 0.2 });
    const parsed = JSON.parse(res.content || '{}') as { likelyService?: string; summary?: string; cancelSteps?: string[] };
    return {
      available: true,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      cancelSteps: Array.isArray(parsed.cancelSteps) ? parsed.cancelSteps.slice(0, 8).map(String) : [],
      likelyService: typeof parsed.likelyService === 'string' ? parsed.likelyService : null,
    };
  } catch (err) {
    return { available: true, summary: `LLM error: ${(err as Error).message.slice(0, 200)}`, cancelSteps: [], likelyService: null };
  }
}
