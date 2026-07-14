// Auto-learn categorization rules (v0.5.0). Infers candidate Rules from the
// user's own categorization patterns: when a merchant's transactions are
// consistently filed under one category but NO existing rule covers that
// merchant, propose a rule so future transactions auto-categorize. The user
// accepts with one click (which POSTs to /api/rules).
//
// Pattern-mining over existing edits rather than per-edit hooks — robust, and
// it surfaces the backlog of "I keep categorizing this the same way" cases.

import { prisma } from './prisma';

export type RuleSuggestion = {
  merchant: string;
  category: string;     // dominant category name
  count: number;        // txns of this merchant filed under `category`
  total: number;        // total categorized txns for this merchant
  confidence: number;   // count / total (0..1)
  rule: {
    name: string;
    matchField: 'merchant';
    matchType: 'substring';
    matchValue: string;
    caseInsensitive: true;
    applyCategory: string;
  };
};

const MIN_TXNS = 3;          // need a few examples before suggesting
const MIN_CONFIDENCE = 0.6;  // dominant category must be a clear majority

export async function suggestRules(limit = 20): Promise<RuleSuggestion[]> {
  // Existing enabled merchant-rules — used to skip merchants already covered.
  const rules = await prisma.rule.findMany({
    where: { enabled: true, matchField: 'merchant' },
    select: { matchValue: true, caseInsensitive: true },
  });
  const covered = (merchant: string) => {
    const m = merchant.toLowerCase();
    return rules.some(r => {
      const v = r.matchValue.toLowerCase();
      return v && m.includes(v);
    });
  };

  // All categorized, non-transfer, non-split-child transactions with a merchant.
  const txs = await prisma.transaction.findMany({
    where: { categoryId: { not: null }, merchant: { not: null }, isTransfer: false, parentTransactionId: null },
    select: { merchant: true, categoryId: true },
  });
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  const catName = new Map(cats.map(c => [c.id, c.name]));

  // merchant → category → count
  const byMerchant = new Map<string, Map<string, number>>();
  for (const t of txs) {
    const m = (t.merchant ?? '').trim();
    if (!m || !t.categoryId) continue;
    const inner = byMerchant.get(m) ?? new Map<string, number>();
    inner.set(t.categoryId, (inner.get(t.categoryId) ?? 0) + 1);
    byMerchant.set(m, inner);
  }

  const out: RuleSuggestion[] = [];
  for (const [merchant, catCounts] of byMerchant) {
    const total = [...catCounts.values()].reduce((s, n) => s + n, 0);
    if (total < MIN_TXNS) continue;
    if (covered(merchant)) continue; // a rule already handles this merchant
    let topCat = '', topCount = 0;
    for (const [cid, n] of catCounts) if (n > topCount) { topCount = n; topCat = cid; }
    const confidence = topCount / total;
    if (confidence < MIN_CONFIDENCE) continue; // not consistent enough
    const category = catName.get(topCat);
    if (!category) continue;
    out.push({
      merchant, category, count: topCount, total,
      confidence: Math.round(confidence * 100) / 100,
      rule: { name: `Auto: ${merchant}`, matchField: 'merchant', matchType: 'substring', matchValue: merchant, caseInsensitive: true, applyCategory: category },
    });
  }

  // Most-used + most-confident first.
  out.sort((a, b) => (b.count - a.count) || (b.confidence - a.confidence));
  return out.slice(0, limit);
}
