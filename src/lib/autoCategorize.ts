import { prisma } from './prisma';
import { chat, llmAvailable } from './llm';
import { categorize as ruleCategorize } from './categorize';

export type AutoCategorizeResult = {
  considered: number;
  updated: number;
  llmUsed: boolean;
  byCategory: Record<string, number>;
  errors: string[];
};

const BATCH_SIZE = 25;
const MAX_TX = 500;

/**
 * Auto-categorize transactions. When mode='uncategorized' (default), only touch
 * tx where categoryId is null or maps to 'Other'. When mode='all', re-classify
 * everything in the selection. Hits the local LLM (Ollama) for context-aware
 * grouping, falls back to rule-based categorization when LLM unreachable.
 */
export async function autoCategorize(opts: {
  mode?: 'uncategorized' | 'all';
  since?: Date;
  txIds?: string[];
} = {}): Promise<AutoCategorizeResult> {
  const mode = opts.mode ?? 'uncategorized';

  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  const catByName = new Map(categories.map(c => [c.name.toLowerCase(), c]));
  const otherCat = categories.find(c => c.name.toLowerCase() === 'other');

  const where: Record<string, unknown> = { isTransfer: false };
  if (opts.txIds?.length) where.id = { in: opts.txIds };
  if (opts.since) where.date = { gte: opts.since };
  if (mode === 'uncategorized') {
    where.OR = [
      { categoryId: null },
      ...(otherCat ? [{ categoryId: otherCat.id }] : []),
    ];
  }

  const txs = await prisma.transaction.findMany({
    where, take: MAX_TX,
    orderBy: { date: 'desc' },
    select: { id: true, merchant: true, rawDescription: true, amount: true },
  });

  const result: AutoCategorizeResult = {
    considered: txs.length,
    updated: 0,
    llmUsed: false,
    byCategory: {},
    errors: [],
  };
  if (txs.length === 0) return result;

  const llmReady = await llmAvailable();
  result.llmUsed = llmReady;

  // Helper: write assignment if category exists and is a real change
  const assignments = new Map<string, string>(); // txId → categoryName

  if (!llmReady) {
    for (const t of txs) {
      const name = ruleCategorize(t.merchant ?? '', t.rawDescription, t.amount);
      assignments.set(t.id, name);
    }
  } else {
    const catList = categories.map(c => c.name).join(', ');
    for (let i = 0; i < txs.length; i += BATCH_SIZE) {
      const batch = txs.slice(i, i + BATCH_SIZE);
      try {
        const assigned = await callLLM(batch, catList);
        for (const a of assigned) {
          // Validate category exists
          if (catByName.has(a.category.toLowerCase())) {
            assignments.set(a.id, a.category);
          }
        }
        // Fill any missed ones with rule fallback
        for (const t of batch) {
          if (!assignments.has(t.id)) {
            assignments.set(t.id, ruleCategorize(t.merchant ?? '', t.rawDescription, t.amount));
          }
        }
      } catch (err) {
        result.errors.push(`Batch ${i / BATCH_SIZE + 1}: ${(err as Error).message}`);
        for (const t of batch) {
          assignments.set(t.id, ruleCategorize(t.merchant ?? '', t.rawDescription, t.amount));
        }
      }
    }
  }

  // Resolve tags whose names match the classification labels - we'll attach
  // them alongside the legacy category for the migration-period of dual-write.
  const tagByName = new Map<string, string>();
  if (assignments.size > 0) {
    const allNames = [...new Set([...assignments.values()].map(n => n.toLowerCase()))];
    const tags = await prisma.tag.findMany({ where: { name: { in: allNames } } });
    for (const t of tags) tagByName.set(t.name.toLowerCase(), t.id);
  }

  // Write back
  for (const [txId, name] of assignments) {
    const cat = catByName.get(name.toLowerCase());
    if (!cat) continue;
    const tagId = tagByName.get(name.toLowerCase());
    await prisma.transaction.update({
      where: { id: txId },
      data: {
        categoryId: cat.id,
        ...(tagId ? { tags: { connect: { id: tagId } } } : {}),
      },
    });
    result.updated += 1;
    result.byCategory[cat.name] = (result.byCategory[cat.name] ?? 0) + 1;
  }

  return result;
}

async function callLLM(
  txs: Array<{ id: string; merchant: string | null; rawDescription: string; amount: number }>,
  catList: string,
): Promise<Array<{ id: string; category: string }>> {
  const sys = `You are a personal-finance transaction categorizer. Given a list of bank/credit-card transactions, return the best-fitting category for each. Use ONLY these category names verbatim: ${catList}. If nothing matches well, use "Other".`;
  const user = `Categorize these transactions. Return strict JSON of shape: {"assignments":[{"id":"<id>","category":"<CategoryName>"}, ...]}\n\nTransactions:\n` +
    txs.map(t => `- id=${t.id} | merchant="${t.merchant ?? ''}" | desc="${t.rawDescription.slice(0, 120)}" | amount=${t.amount.toFixed(2)}`).join('\n');

  const res = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { responseFormat: 'json_object', temperature: 0.1 });

  let parsed: { assignments?: Array<{ id: string; category: string }> };
  try { parsed = JSON.parse(res.content || '{}'); }
  catch { throw new Error('LLM returned non-JSON: ' + res.content.slice(0, 200)); }
  return parsed.assignments ?? [];
}

/** Set a single transaction's category (manual override). Pass null to clear. */
export async function setTxCategory(txId: string, categoryName: string | null): Promise<void> {
  if (categoryName === null) {
    await prisma.transaction.update({ where: { id: txId }, data: { categoryId: null } });
    return;
  }
  const cat = await prisma.category.findFirst({ where: { name: categoryName } });
  if (!cat) throw new Error(`Unknown category: ${categoryName}`);
  await prisma.transaction.update({ where: { id: txId }, data: { categoryId: cat.id } });
}

/** Apply one manual category to a bounded set of selected transactions. */
export async function setTxCategories(txIds: string[], categoryName: string | null): Promise<number> {
  const ids = [...new Set(txIds.filter(Boolean))].slice(0, 500);
  if (ids.length === 0) return 0;
  if (categoryName === null) {
    return (await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId: null } })).count;
  }
  const cat = await prisma.category.findFirst({ where: { name: categoryName } });
  if (!cat) throw new Error(`Unknown category: ${categoryName}`);
  return (await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId: cat.id } })).count;
}
