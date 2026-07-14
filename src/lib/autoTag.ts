import { prisma } from './prisma';
import { chat, llmAvailable } from './llm';

export type AutoTagResult = {
  considered: number;
  tagged: number;
  totalAttachments: number;
  llmUsed: boolean;
  byTag: Record<string, number>;
  errors: string[];
  propagated?: { subscriptions: number; transactions: number; attachments: number };
};

/**
 * Mirror every subscription's tags down to all of its linked transactions.
 * Idempotent - connect is a no-op when the tag is already attached.
 *
 * If subscriptionId is provided, only that subscription's txs are updated;
 * otherwise every subscription with at least one tag is processed.
 */
export async function propagateSubscriptionTags(opts: {
  subscriptionId?: string;
  since?: Date;
} = {}): Promise<{ subscriptions: number; transactions: number; attachments: number }> {
  const subs = await prisma.subscription.findMany({
    where: opts.subscriptionId ? { id: opts.subscriptionId } : { tags: { some: {} } },
    select: { id: true, tags: { select: { id: true } } },
  });
  const { attachTagsNormalized } = await import('./tags');
  let touchedSubs = 0, touchedTxs = 0, attachments = 0;
  for (const s of subs) {
    if (s.tags.length === 0) continue;
    const tagIds = s.tags.map(t => t.id);
    const txs = await prisma.transaction.findMany({
      where: { subscriptionId: s.id, ...(opts.since ? { date: { gte: opts.since } } : {}) },
      select: { id: true },
    });
    if (txs.length === 0) continue;
    touchedSubs += 1;
    for (const t of txs) {
      // Normalizer enforces single-primary + parent/child dedup. Without it
      // a sub with 3 stacked tags would broadcast 3 chips to every charge.
      const r = await attachTagsNormalized({ transactionId: t.id, tagIds });
      if (r.added.length > 0) touchedTxs += 1;
      attachments += r.added.length;
    }
  }
  return { subscriptions: touchedSubs, transactions: touchedTxs, attachments };
}

const BATCH_SIZE = 12;          // smaller batch - each tx carries more context than a category prompt
const MAX_TX = 300;
const RAW_EMAIL_CHARS = 800;     // truncated per tx so prompt stays bounded

/**
 * LLM-driven tagging.
 *
 * Enriches each transaction with:
 *   - merchant + raw bank description + amount + date
 *   - any matched Order's items (parsed JSON) + URL + first 800 chars of raw email
 *
 * Sends the full tag tree (parent + children, primary/secondary) to the LLM
 * and asks it to return zero-or-more tag names per transaction. Multiple tags
 * are common (e.g. "Subscription/Entertainment" + "Reimbursable").
 */
export async function autoTag(opts: {
  mode?: 'untagged' | 'all';
  since?: Date;
  txIds?: string[];
} = {}): Promise<AutoTagResult> {
  const mode = opts.mode ?? 'untagged';

  const tags = await prisma.tag.findMany({
    include: { parent: { select: { name: true } } },
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  const tagByName = new Map(tags.map(t => [t.name.toLowerCase(), t]));

  const where: Record<string, unknown> = { isTransfer: false };
  if (opts.txIds?.length) where.id = { in: opts.txIds };
  if (opts.since) where.date = { gte: opts.since };
  if (mode === 'untagged') where.tags = { none: {} };

  const txs = await prisma.transaction.findMany({
    where, take: MAX_TX,
    orderBy: { date: 'desc' },
    select: {
      id: true, merchant: true, rawDescription: true, amount: true, date: true,
      orders: { select: { merchant: true, items: true, url: true, raw: true, source: true } },
    },
  });

  const result: AutoTagResult = {
    considered: txs.length, tagged: 0, totalAttachments: 0,
    llmUsed: false, byTag: {}, errors: [],
  };

  // Fast path FIRST: any subscription that already has tags propagates them
  // to its linked transactions before we spend LLM tokens on them.
  result.propagated = await propagateSubscriptionTags({ since: opts.since });

  if (txs.length === 0 || tags.length === 0) return result;

  const llmReady = await llmAvailable();
  result.llmUsed = llmReady;
  if (!llmReady) {
    result.errors.push('Local LLM unreachable - auto-tag requires Ollama on OLLAMA_BASE_URL.');
    return result;
  }

  const assignments = new Map<string, string[]>(); // txId → tagNames[]

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const batch = txs.slice(i, i + BATCH_SIZE);
    try {
      const assigned = await callLLM(batch, tags);
      for (const a of assigned) {
        // Filter to only tag names that actually exist (case-insensitive).
        const validNames = a.tags.filter(n => tagByName.has(n.toLowerCase()));
        if (validNames.length > 0) assignments.set(a.id, validNames);
      }
    } catch (err) {
      result.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${(err as Error).message}`);
    }
  }

  // Write back through the normalizer so the single-primary + child-supersedes-
  // parent rules apply uniformly. The LLM prompt also asks for at most 2 tags,
  // but the normalizer is the durable enforcement point.
  const { attachTagsNormalized } = await import('./tags');
  for (const [txId, tagNames] of assignments) {
    const tagIds = tagNames
      .map(n => tagByName.get(n.toLowerCase())?.id)
      .filter((id): id is string => !!id);
    if (tagIds.length === 0) continue;
    const r = await attachTagsNormalized({ transactionId: txId, tagIds });
    if (r.added.length === 0) continue;
    result.tagged += 1;
    result.totalAttachments += r.added.length;
    for (const n of tagNames) result.byTag[n] = (result.byTag[n] ?? 0) + 1;
  }

  return result;
}

type TagRow = { id: string; name: string; kind: string; parentId: string | null; parent: { name: string } | null };

async function callLLM(
  batch: Awaited<ReturnType<typeof loadBatch>>,
  tags: TagRow[],
): Promise<Array<{ id: string; tags: string[] }>> {
  // Build a readable tag catalog: parents first, then their children indented.
  const parents = tags.filter(t => !t.parentId);
  const childrenOf = (pid: string) => tags.filter(t => t.parentId === pid);
  const lines: string[] = [];
  for (const p of parents) {
    lines.push(`- "${p.name}" (${p.kind})`);
    for (const c of childrenOf(p.id)) lines.push(`    - "${c.name}" (${c.kind}, child of "${p.name}")`);
  }
  for (const orphan of tags.filter(t => t.parentId && !parents.some(p => p.id === t.parentId))) {
    lines.push(`- "${orphan.name}" (${orphan.kind})`);
  }
  const catalog = lines.join('\n');

  const sys = [
    'You are a personal-finance tag classifier. Pick the most relevant tags for each transaction.',
    'Rules:',
    '- Pick AT MOST 2 tags per transaction: ONE primary (the category - what is this?) plus OPTIONALLY ONE secondary modifier (e.g. "Reimbursable", "Tax deductible").',
    '- NEVER attach both a parent AND its child. The child is more specific; pick the child alone.',
    '- Use ONLY tag names from the catalog below - verbatim spelling.',
    '- If nothing fits well, return an empty list for that transaction - do NOT invent tags.',
    '',
    'Catalog (name, kind, parent-context):',
    catalog,
  ].join('\n');

  const txDescriptions = batch.map(t => {
    const order = t.orders[0];
    const items = order?.items
      ? safeParseItems(order.items).slice(0, 5).map(i => i.name).filter(Boolean).join(', ')
      : '';
    const emailSnippet = order?.raw
      ? order.raw.replace(/\s+/g, ' ').trim().slice(0, RAW_EMAIL_CHARS)
      : '';
    return [
      `id=${t.id}`,
      `merchant="${t.merchant ?? ''}"`,
      `desc="${t.rawDescription.slice(0, 200)}"`,
      `amount=${t.amount.toFixed(2)}`,
      `date=${t.date.toISOString().slice(0, 10)}`,
      order ? `order_source="${order.source}"` : '',
      items ? `items="${items}"` : '',
      emailSnippet ? `email_snippet="${emailSnippet}"` : '',
    ].filter(Boolean).join(' | ');
  }).join('\n');

  const user = [
    'Tag the following transactions. Return strict JSON:',
    '{"assignments":[{"id":"<txid>","tags":["TagA","TagB"]}, ...]}',
    '',
    'Transactions:',
    txDescriptions,
  ].join('\n');

  const res = await chat([
    { role: 'system', content: sys },
    { role: 'user',   content: user },
  ], { responseFormat: 'json_object', temperature: 0.15 });

  let parsed: { assignments?: Array<{ id: string; tags: string[] }> };
  try { parsed = JSON.parse(res.content || '{}'); }
  catch { throw new Error('LLM returned non-JSON: ' + res.content.slice(0, 200)); }
  return (parsed.assignments ?? []).filter(a => a?.id && Array.isArray(a.tags));
}

// Just for the type
async function loadBatch() {
  return prisma.transaction.findMany({
    select: {
      id: true, merchant: true, rawDescription: true, amount: true, date: true,
      orders: { select: { merchant: true, items: true, url: true, raw: true, source: true } },
    },
  });
}

function safeParseItems(s: string): Array<{ name?: string; qty?: number }> {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
