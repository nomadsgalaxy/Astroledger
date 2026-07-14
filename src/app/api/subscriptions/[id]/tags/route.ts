import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { propagateSubscriptionTags } from '@/lib/autoTag';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { add?: string[]; remove?: string[] };
  await prisma.subscription.update({
    where: { id },
    data: {
      tags: {
        ...(body.add?.length ? { connect: body.add.map(tagId => ({ id: tagId })) } : {}),
        ...(body.remove?.length ? { disconnect: body.remove.map(tagId => ({ id: tagId })) } : {}),
      },
    },
  });

  // After an add, mirror every current tag down to every linked transaction.
  // Removes do NOT cascade - the user may have intentionally over-tagged a
  // specific charge; we don't yank tags from history when the sub loses one.
  let propagated: { subscriptions: number; transactions: number; attachments: number } | undefined;
  if (body.add?.length) {
    propagated = await propagateSubscriptionTags({ subscriptionId: id });
  }
  return NextResponse.json({ ok: true, propagated });
}
