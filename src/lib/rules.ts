// Categorization rules engine.
//
// Rules are user-defined transformations that run on every new transaction,
// regardless of import path. Each rule matches a substring or regex against
// rawDescription or merchant, optionally filtered by account / amount band,
// and applies any subset of: tags, category, isTransfer flag, merchant rename.
//
// applyRulesToTransaction(txId) runs all enabled rules sorted by sortOrder
// (low → high). Highest sortOrder wins for the merchant rename + category;
// tag attachments union across all matching rules.

import { prisma } from './prisma';

export type CompiledRule = {
  id: string;
  name: string;
  matcher: (subject: string) => boolean;
  matchField: 'rawDescription' | 'merchant';
  accountIds: string[] | null;
  minAmount: number | null;
  maxAmount: number | null;
  applyTagIds: string[];
  applyCategory: string | null;
  applyIsTransfer: boolean | null;
  applyMerchant: string | null;
  sortOrder: number;
};

function compile(r: {
  id: string; name: string; matchType: string; matchField: string; matchValue: string; caseInsensitive: boolean;
  accountIds: string | null; minAmount: number | null; maxAmount: number | null;
  applyTagIds: string | null; applyCategory: string | null; applyIsTransfer: boolean | null; applyMerchant: string | null;
  sortOrder: number;
}): CompiledRule {
  const flags = r.caseInsensitive ? 'i' : '';
  let matcher: (s: string) => boolean;
  if (r.matchType === 'regex') {
    let re: RegExp;
    try { re = new RegExp(r.matchValue, flags); }
    catch { re = /a^/; } // never matches
    matcher = s => re.test(s);
  } else {
    const needle = r.caseInsensitive ? r.matchValue.toLowerCase() : r.matchValue;
    matcher = s => (r.caseInsensitive ? s.toLowerCase() : s).includes(needle);
  }
  return {
    id: r.id, name: r.name, matcher,
    matchField: r.matchField === 'merchant' ? 'merchant' : 'rawDescription',
    accountIds: r.accountIds ? (JSON.parse(r.accountIds) as string[]) : null,
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    applyTagIds: r.applyTagIds ? (JSON.parse(r.applyTagIds) as string[]) : [],
    applyCategory: r.applyCategory,
    applyIsTransfer: r.applyIsTransfer,
    applyMerchant: r.applyMerchant,
    sortOrder: r.sortOrder,
  };
}

let cache: { rules: CompiledRule[]; stamp: number } | null = null;
const CACHE_MS = 30_000;

async function loadRules(): Promise<CompiledRule[]> {
  if (cache && Date.now() - cache.stamp < CACHE_MS) return cache.rules;
  const rows = await prisma.rule.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  cache = { rules: rows.map(compile), stamp: Date.now() };
  return cache.rules;
}

export function invalidateRulesCache() { cache = null; }

/**
 * Apply all matching rules to the given transaction. Idempotent - re-running
 * yields the same final state (tags use connect which silently no-ops dupes;
 * merchant/category set to the same value is a no-op).
 */
export async function applyRulesToTransaction(transactionId: string): Promise<{
  matched: number; tagsAttached: number; merchantRenamed: string | null; categorySet: string | null; isTransferSet: boolean | null;
}> {
  const rules = await loadRules();
  if (rules.length === 0) return { matched: 0, tagsAttached: 0, merchantRenamed: null, categorySet: null, isTransferSet: null };

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, accountId: true, amount: true, rawDescription: true, merchant: true, isTransfer: true },
  });
  if (!tx) return { matched: 0, tagsAttached: 0, merchantRenamed: null, categorySet: null, isTransferSet: null };

  const matches = rules.filter(r => {
    if (r.accountIds && !r.accountIds.includes(tx.accountId)) return false;
    const abs = Math.abs(tx.amount);
    if (r.minAmount != null && abs < r.minAmount) return false;
    if (r.maxAmount != null && abs > r.maxAmount) return false;
    const subject = r.matchField === 'merchant' ? (tx.merchant ?? '') : tx.rawDescription;
    return r.matcher(subject);
  });
  if (matches.length === 0) return { matched: 0, tagsAttached: 0, merchantRenamed: null, categorySet: null, isTransferSet: null };

  // Union tag attachments across all matches
  const allTagIds = new Set<string>();
  for (const m of matches) for (const t of m.applyTagIds) allTagIds.add(t);

  // Highest-sortOrder match wins for category + merchant + isTransfer
  matches.sort((a, b) => b.sortOrder - a.sortOrder);
  const top = matches[0];

  const data: Record<string, unknown> = {};
  let merchantRenamed: string | null = null;
  let categorySet: string | null = null;
  let isTransferSet: boolean | null = null;

  if (top.applyMerchant) { data.merchant = top.applyMerchant; merchantRenamed = top.applyMerchant; }
  if (top.applyCategory) {
    const cat = await prisma.category.findFirst({ where: { name: top.applyCategory } });
    if (cat) { data.categoryId = cat.id; categorySet = top.applyCategory; }
  }
  if (top.applyIsTransfer !== null) { data.isTransfer = top.applyIsTransfer; isTransferSet = top.applyIsTransfer; }
  if (allTagIds.size > 0) {
    data.tags = { connect: Array.from(allTagIds).map(id => ({ id })) };
  }

  if (Object.keys(data).length > 0) {
    await prisma.transaction.update({ where: { id: transactionId }, data });
  }
  return {
    matched: matches.length,
    tagsAttached: allTagIds.size,
    merchantRenamed, categorySet, isTransferSet,
  };
}

/** Re-apply all rules to the entire transaction set. Useful after adding a new rule. */
export async function applyRulesToAll(opts: { limit?: number; sinceDays?: number } = {}): Promise<{ examined: number; matched: number }> {
  const where: any = {};
  if (opts.sinceDays) where.date = { gte: new Date(Date.now() - opts.sinceDays * 86400000) };
  const ids = await prisma.transaction.findMany({
    where, select: { id: true }, orderBy: { date: 'desc' }, take: opts.limit ?? 5000,
  });
  let matched = 0;
  for (const { id } of ids) {
    const r = await applyRulesToTransaction(id);
    if (r.matched > 0) matched++;
  }
  return { examined: ids.length, matched };
}
