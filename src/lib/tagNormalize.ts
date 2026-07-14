// Pure helper for tag-clutter rules. Lives in its own module (no Prisma,
// no `server-only`) so it can be unit-tested directly and reused on the
// client if a future picker wants to preview the diff before posting.
//
// Used server-side via attachTagsNormalized() in lib/tags.ts.

/**
 * Normalize a tag attach request against the tag-clutter rules.
 *
 * Rules:
 *   1. AT MOST ONE PRIMARY TAG per transaction. If `incomingIds` contains a
 *      primary tag, any existing primary tags are pushed into `disconnect`.
 *      Multiple incoming primaries → the LAST one wins (caller's most
 *      recent intent).
 *   2. CHILD SUPERSEDES PARENT. For any tag in the candidate set, if its
 *      parent is also present, the parent is dropped. The child carries
 *      enough meaning on its own.
 */
export function normalizeTagAttach(opts: {
  existingIds: string[];
  incomingIds: string[];
  catalog: Array<{ id: string; kind: 'primary' | 'secondary'; parentId: string | null }>;
}): { connect: string[]; disconnect: string[] } {
  const { existingIds, incomingIds, catalog } = opts;
  const byId = new Map(catalog.map(t => [t.id, t]));
  const existing = new Set(existingIds);

  const candidate = new Set([...existingIds, ...incomingIds]);

  // Rule 1: at most one primary.
  const incomingPrimaries = incomingIds.filter(id => byId.get(id)?.kind === 'primary');
  if (incomingPrimaries.length > 0) {
    const winner = incomingPrimaries[incomingPrimaries.length - 1];
    for (const id of [...candidate]) {
      if (id === winner) continue;
      if (byId.get(id)?.kind === 'primary') candidate.delete(id);
    }
  }

  // Rule 2: child supersedes parent.
  for (const id of candidate) {
    const t = byId.get(id);
    if (!t || !t.parentId) continue;
    if (candidate.has(t.parentId)) candidate.delete(t.parentId);
  }

  const connect: string[] = [];
  const disconnect: string[] = [];
  for (const id of candidate) if (!existing.has(id)) connect.push(id);
  for (const id of existing) if (!candidate.has(id)) disconnect.push(id);
  return { connect, disconnect };
}
