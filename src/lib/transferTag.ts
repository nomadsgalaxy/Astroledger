// Lazy-ensure the system "Transfer" tag exists. Attached to both sides of
// every paired transfer so they're filterable + visually grouped throughout
// the UI without special-casing isTransfer in every component.
import { prisma } from './prisma';

const TRANSFER_TAG_NAME = 'Transfer';
const TRANSFER_TAG_COLOR = '#06B6D4'; // cyan - distinct from spend (orange) + income (green)

let cachedId: string | null = null;
let cacheStamp = 0;
const CACHE_MS = 60_000; // re-check every minute in case the user deletes the tag

export async function getOrCreateTransferTagId(): Promise<string> {
  if (cachedId && Date.now() - cacheStamp < CACHE_MS) return cachedId;
  let tag = await prisma.tag.findFirst({ where: { name: TRANSFER_TAG_NAME, parentId: null } });
  if (!tag) {
    tag = await prisma.tag.create({
      data: { name: TRANSFER_TAG_NAME, kind: 'primary', color: TRANSFER_TAG_COLOR, sortOrder: 0 },
    });
  }
  cachedId = tag.id; cacheStamp = Date.now();
  return tag.id;
}

/**
 * Attach the Transfer tag to the given transaction ids. Idempotent - Prisma's
 * implicit M:N junction silently swallows duplicate connects.
 */
export async function attachTransferTag(transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const tagId = await getOrCreateTransferTagId();
  for (const id of transactionIds) {
    await prisma.transaction.update({
      where: { id },
      data: { tags: { connect: { id: tagId } } },
    }).catch(() => null); // tx may have been deleted between batches
  }
}

/**
 * One-shot backfill: every isTransfer=true row gets the tag, every
 * non-transfer that has the tag gets it removed (cleans up if someone
 * unpairs a transfer manually). Returns counts for observability.
 */
export async function backfillTransferTags(): Promise<{ attached: number; detached: number }> {
  const tagId = await getOrCreateTransferTagId();
  // Attach to all isTransfer=true rows not already tagged
  const toAttach = await prisma.transaction.findMany({
    where: { isTransfer: true, NOT: { tags: { some: { id: tagId } } } },
    select: { id: true },
  });
  for (const t of toAttach) {
    await prisma.transaction.update({
      where: { id: t.id },
      data: { tags: { connect: { id: tagId } } },
    }).catch(() => null);
  }
  // Detach from any isTransfer=false rows that still hold the tag (cleanup)
  const toDetach = await prisma.transaction.findMany({
    where: { isTransfer: false, tags: { some: { id: tagId } } },
    select: { id: true },
  });
  for (const t of toDetach) {
    await prisma.transaction.update({
      where: { id: t.id },
      data: { tags: { disconnect: { id: tagId } } },
    }).catch(() => null);
  }
  return { attached: toAttach.length, detached: toDetach.length };
}
