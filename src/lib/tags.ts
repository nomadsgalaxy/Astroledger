import { prisma } from './prisma';
import { normalizeTagAttach as normalizeTagAttachPure } from './tagNormalize';
export { normalizeTagAttach } from './tagNormalize';

export type TagLite = {
  id: string;
  name: string;
  color: string | null;
  kind: 'primary' | 'secondary';
  parentId: string | null;
  sortOrder: number;
  parentName?: string | null;
  parentColor?: string | null;
};

/** Flattened tag list with parent name + color resolved - convenient for pickers. */
export async function listTagsFlat(): Promise<TagLite[]> {
  const tags = await prisma.tag.findMany({
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { parent: { select: { name: true, color: true } } },
  });
  return tags.map(t => ({
    id: t.id, name: t.name, color: t.color,
    kind: (t.kind === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
    parentId: t.parentId, sortOrder: t.sortOrder,
    parentName: t.parent?.name ?? null,
    parentColor: t.parent?.color ?? null,
  }));
}

/** Format a tag like "Subscription / Entertainment" given parent context. */
export function tagPath(t: TagLite): string {
  return t.parentName ? `${t.parentName} / ${t.name}` : t.name;
}

const MIGRATION_KEY = 'categories_migrated_to_tags_v1';
const UUID_BACKFILL_KEY = 'uuid_backfill_v1';

// Browser-friendly UUIDv4 (crypto.randomUUID is in Node 18+ and modern browsers).
function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Backfill UUIDs onto every Tag + Transaction row that doesn't have one. */
export async function backfillUuids(): Promise<{ tags: number; transactions: number; skipped: boolean }> {
  const { prisma } = await import('./prisma');
  const flag = await prisma.appSetting.findUnique({ where: { key: UUID_BACKFILL_KEY } });
  if (flag?.value === 'done') return { tags: 0, transactions: 0, skipped: true };

  // Tag batch — usually small. Still batched so we keep the same pattern.
  const tagsMissing = await prisma.tag.findMany({ where: { uuid: null }, select: { id: true } });
  if (tagsMissing.length > 0) {
    await prisma.$transaction(
      tagsMissing.map(t => prisma.tag.update({ where: { id: t.id }, data: { uuid: uuid() } })),
    );
  }
  // Walk transactions in pages and batch each page into a single
  // $transaction. Per-row awaits used to timeout SQLite on accounts with
  // thousands of pre-backfill transactions during /settings page render.
  let txCount = 0, cursor: string | undefined;
  while (true) {
    const page = await prisma.transaction.findMany({
      where: { uuid: null },
      orderBy: { id: 'asc' }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (page.length === 0) break;
    await prisma.$transaction(
      page.map(t => prisma.transaction.update({ where: { id: t.id }, data: { uuid: uuid() } })),
    );
    txCount += page.length;
    cursor = page[page.length - 1].id;
    if (page.length < 500) break;
  }
  await prisma.appSetting.upsert({
    where: { key: UUID_BACKFILL_KEY },
    create: { key: UUID_BACKFILL_KEY, value: 'done' },
    update: { value: 'done' },
  });
  return { tags: tagsMissing.length, transactions: txCount, skipped: false };
}

/**
 * Apply normalizeTagAttach (from ./tagNormalize) against a real transaction:
 * reads existing tags, computes the diff, runs the connect/disconnect,
 * returns what changed. Used by every server-side caller that adds tags:
 *   - /api/transactions/[id]/tags    (manual picker)
 *   - runBudgetTool 'attach_tags'    (MCP / LLM tool surface)
 *   - autoTag write-back             (LLM bulk classification)
 *   - propagateSubscriptionTags      (sub-to-tx mirror)
 */
export async function attachTagsNormalized(opts: {
  transactionId: string;
  tagIds: string[];
}): Promise<{ added: string[]; removed: string[] }> {
  const { prisma } = await import('./prisma');
  const [existing, catalog] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id: opts.transactionId },
      select: { tags: { select: { id: true } } },
    }),
    prisma.tag.findMany({ select: { id: true, kind: true, parentId: true } }),
  ]);
  if (!existing) return { added: [], removed: [] };
  const { connect, disconnect } = normalizeTagAttachPure({
    existingIds: existing.tags.map(t => t.id),
    incomingIds: opts.tagIds,
    catalog: catalog.map(c => ({
      id: c.id,
      kind: (c.kind === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
      parentId: c.parentId,
    })),
  });
  if (connect.length === 0 && disconnect.length === 0) return { added: [], removed: [] };
  await prisma.transaction.update({
    where: { id: opts.transactionId },
    data: {
      tags: {
        ...(connect.length ? { connect: connect.map(id => ({ id })) } : {}),
        ...(disconnect.length ? { disconnect: disconnect.map(id => ({ id })) } : {}),
      },
    },
  });
  return { added: connect, removed: disconnect };
}

/**
 * Propagate any tag attached to `sourceTxId` to every other transaction with
 * the same normalized merchant. Each sibling is normalized through
 * attachTagsNormalized so the single-primary + parent/child rules apply.
 *
 * Returns how many rows actually gained a new attachment (best-effort count -
 * exact-zero is hard to compute without a separate diffing query).
 */
export async function propagateTagsByMerchant(sourceTxId: string): Promise<{ siblings: number; tagsApplied: number }> {
  const { prisma } = await import('./prisma');
  const source = await prisma.transaction.findUnique({
    where: { id: sourceTxId },
    select: { merchant: true, tags: { select: { id: true } } },
  });
  if (!source?.merchant || source.tags.length === 0) return { siblings: 0, tagsApplied: 0 };

  const siblings = await prisma.transaction.findMany({
    where: { merchant: source.merchant, id: { not: sourceTxId } },
    select: { id: true },
  });
  const sourceTagIds = source.tags.map(t => t.id);
  // Run each sibling through the normalizer so the single-primary + parent/
  // child rules apply consistently with the manual picker. The naive
  // `tags: { connect }` path bypassed both rules and was the main source of
  // chip-stacking when the source tx itself was over-tagged.
  let appliedTotal = 0;
  for (const s of siblings) {
    const r = await attachTagsNormalized({ transactionId: s.id, tagIds: sourceTagIds });
    appliedTotal += r.added.length;
  }
  return { siblings: siblings.length, tagsApplied: appliedTotal };
}

/**
 * One-time migration: every Category becomes a primary tag with the same
 * name/color, and every transaction with that categoryId gets the matching
 * tag attached. Idempotent - guarded by AppSetting key.
 *
 * Categories remain in the schema as a legacy/back-compat column so older
 * aggregations (Cashflow, Budgets, Reports) keep working until they're
 * reworked to read from tags directly.
 */
export async function migrateCategoriesToTags() {
  const { prisma } = await import('./prisma');
  const flag = await prisma.appSetting.findUnique({ where: { key: MIGRATION_KEY } });
  if (flag?.value === 'done') return { skipped: true, tagged: 0, created: 0 };

  const categories = await prisma.category.findMany();
  let created = 0;
  // Find existing root-level tag-name collisions so we don't double-create.
  const existing = await prisma.tag.findMany({ where: { parentId: null } });
  const byName = new Map(existing.map(t => [t.name.toLowerCase(), t]));
  const tagByCategoryId = new Map<string, string>();

  for (const c of categories) {
    const existingTag = byName.get(c.name.toLowerCase());
    if (existingTag) {
      tagByCategoryId.set(c.id, existingTag.id);
      continue;
    }
    const t = await prisma.tag.create({
      data: { name: c.name, color: c.color, kind: 'primary', sortOrder: 0 },
    });
    tagByCategoryId.set(c.id, t.id);
    created++;
  }

  // Attach tags to every transaction whose categoryId maps. The original
  // implementation awaited each update sequentially, which hammered SQLite
  // with 1000s of individual write transactions and timed out on real
  // accounts during the /settings page render. Batched into one
  // `$transaction` per page so the entire 500-row chunk hits the DB as a
  // single write transaction.
  let tagged = 0;
  const PAGE = 500;
  let cursor: string | undefined;
  while (true) {
    const page = await prisma.transaction.findMany({
      where: { categoryId: { not: null } },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, categoryId: true },
    });
    if (page.length === 0) break;
    const ops = page
      .filter(t => tagByCategoryId.has(t.categoryId!))
      .map(t => prisma.transaction.update({
        where: { id: t.id },
        data: { tags: { connect: { id: tagByCategoryId.get(t.categoryId!)! } } },
      }));
    if (ops.length > 0) {
      await prisma.$transaction(ops);
      tagged += ops.length;
    }
    cursor = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }

  await prisma.appSetting.upsert({
    where: { key: MIGRATION_KEY },
    create: { key: MIGRATION_KEY, value: 'done' },
    update: { value: 'done' },
  });
  return { skipped: false, tagged, created };
}

// Name of the catch-all parent that owns modifier-style secondaries (flags
// like Reimbursable / Tax deductible). Every secondary tag MUST have a
// parent - if a creator doesn't pick one, this is where the tag lands.
export const MODIFIER_PARENT_NAME = 'Modifier';

/** Get-or-create the catch-all parent for modifier-style secondaries.
 *  Returns the parent tag's id. Idempotent. */
export async function ensureModifierParent(): Promise<string> {
  const existing = await prisma.tag.findFirst({
    where: { name: MODIFIER_PARENT_NAME, parentId: null },
  });
  if (existing) return existing.id;
  const t = await prisma.tag.create({
    data: { name: MODIFIER_PARENT_NAME, kind: 'primary', color: '#7a7a7a', sortOrder: 999 },
  });
  return t.id;
}

const ORPHAN_REPARENT_KEY = 'orphan_secondaries_reparented_v1';

/** One-time migration: every secondary tag with parentId=null gets
 *  reparented to the Modifier primary. Guarded by AppSetting so it only
 *  runs once. New writes are blocked at the API/MCP boundary so legacy
 *  rows are the only ones this needs to clean up. */
export async function reparentOrphanSecondaries(): Promise<{ reparented: number; skipped: boolean }> {
  const flag = await prisma.appSetting.findUnique({ where: { key: ORPHAN_REPARENT_KEY } });
  if (flag?.value === 'done') return { reparented: 0, skipped: true };
  const orphans = await prisma.tag.findMany({
    where: { kind: 'secondary', parentId: null },
    select: { id: true },
  });
  if (orphans.length === 0) {
    await prisma.appSetting.upsert({
      where: { key: ORPHAN_REPARENT_KEY },
      create: { key: ORPHAN_REPARENT_KEY, value: 'done' },
      update: { value: 'done' },
    });
    return { reparented: 0, skipped: false };
  }
  const modifierId = await ensureModifierParent();
  for (const o of orphans) {
    await prisma.tag.update({ where: { id: o.id }, data: { parentId: modifierId } });
  }
  await prisma.appSetting.upsert({
    where: { key: ORPHAN_REPARENT_KEY },
    create: { key: ORPHAN_REPARENT_KEY, value: 'done' },
    update: { value: 'done' },
  });
  return { reparented: orphans.length, skipped: false };
}

/** Seed a handful of starter tags on first boot so the UI isn't empty.
 *  Every secondary lands under a primary - no orphans. */
export async function ensureStarterTags() {
  const existing = await prisma.tag.count();
  if (existing > 0) return;
  const seed: Array<{ name: string; color?: string; children: string[] }> = [
    { name: 'Subscription', color: '#346EF4', children: ['Entertainment', 'SaaS', 'News'] },
    { name: 'Work related', color: '#A855F7', children: ['Food', 'Travel', 'Supplies'] },
    { name: 'Personal',     color: '#65C900', children: ['Gifts', 'Hobbies'] },
    // Modifier owns the flag-style secondaries that aren't bucketed under
    // a real category. They still attach freely (single-primary rule
    // doesn't touch them because they're secondaries with a parent).
    { name: MODIFIER_PARENT_NAME, color: '#7a7a7a', children: ['Reimbursable', 'Tax deductible'] },
  ];
  for (const p of seed) {
    const parent = await prisma.tag.create({
      data: { name: p.name, kind: 'primary', color: p.color ?? null, sortOrder: 0 },
    });
    for (const childName of p.children) {
      await prisma.tag.create({
        data: { name: childName, kind: 'secondary', parentId: parent.id, sortOrder: 0 },
      });
    }
  }
}
