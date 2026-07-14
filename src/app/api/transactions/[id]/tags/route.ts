import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { attachTagsNormalized, propagateTagsByMerchant } from '@/lib/tags';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { add?: string[]; remove?: string[]; propagate?: boolean };

  // Adds go through the normalizer: enforces single-primary + child-supersedes-
  // parent. Removes are direct since the user is explicitly detaching.
  let normalized: { added: string[]; removed: string[] } | undefined;
  if (body.add?.length) {
    normalized = await attachTagsNormalized({ transactionId: id, tagIds: body.add });
  }
  if (body.remove?.length) {
    await prisma.transaction.update({
      where: { id },
      data: { tags: { disconnect: body.remove.map(tagId => ({ id: tagId })) } },
    });
  }

  // On adds, cascade to every other tx with the same merchant. Universal tagging
  // by default - the per-tx picker passes propagate:false when the caller wants
  // a single-row override. Propagation also goes through the normalizer, so
  // chips on siblings don't accidentally stack.
  let propagated: { siblings: number; tagsApplied: number } | undefined;
  if (body.add?.length && body.propagate !== false) {
    propagated = await propagateTagsByMerchant(id);
  }
  return NextResponse.json({ ok: true, normalized, propagated });
}
