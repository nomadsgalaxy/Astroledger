import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const VALID_STATUSES = new Set(['open', 'dismissed', 'done']);

/**
 * PATCH /api/recommendations/[id]
 *
 * Body: { status: "open" | "dismissed" | "done" }
 *
 * Side effects:
 *   - When a subscription-typed rec is marked `done`, the linked Subscription
 *     row also flips to status="canceled" since "I acted on this" only
 *     really means "I cancelled the sub" for that kind of rec. The user can
 *     undo from the Subscriptions page if needed.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { status?: string };
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'status must be open|dismissed|done' }, { status: 400 });
  }
  // Track dismissedAt so the TTL cleanup (see lib/dismissedRecs) knows when
  // each row hit "dismissed". Cleared on re-open or done-promotion.
  const data: { status: string; dismissedAt?: Date | null } = { status: body.status };
  if (body.status === 'dismissed') data.dismissedAt = new Date();
  else data.dismissedAt = null;
  const rec = await prisma.recommendation.update({
    where: { id },
    data,
  }).catch(() => null);
  if (!rec) return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });

  // Cascade: marking a subscription-rec as done implies the user cancelled
  // the sub. Mark the linked Subscription accordingly. Reversible from the
  // Subscriptions page.
  let cascadedSubscription: { id: string; status: string } | null = null;
  if (body.status === 'done' && rec.refType === 'subscription' && rec.refId) {
    const sub = await prisma.subscription.update({
      where: { id: rec.refId },
      data: { status: 'canceled' },
      select: { id: true, status: true },
    }).catch(() => null);
    if (sub) cascadedSubscription = sub;
  }

  return NextResponse.json({ ok: true, recommendation: rec, cascadedSubscription });
}
