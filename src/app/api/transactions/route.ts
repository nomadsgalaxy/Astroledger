import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { txnHash } from '@/lib/hash';
import { normalizeMerchant } from '@/lib/merchant';
import { toBase, BASE_CURRENCY } from '@/lib/fx';

export const runtime = 'nodejs';

/**
 * Create a manual transaction. Used by the "+ Add manual" dialog. Server
 * supplies the UUID via the schema default - the user never sees it on the
 * way in, but it's persistent from that point forward.
 *
 * Body: { accountId, date (ISO), amount (signed), merchant?, rawDescription?, notes?, tagIds? }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as null | {
    accountId: string; date: string; amount: number;
    currency?: string;
    merchant?: string; rawDescription?: string; notes?: string | null;
    tagIds?: string[];
    isAnticipated?: boolean;
  };
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  if (!body.accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  if (!body.date)      return NextResponse.json({ error: 'date required' }, { status: 400 });
  if (typeof body.amount !== 'number' || Number.isNaN(body.amount)) {
    return NextResponse.json({ error: 'amount must be a number' }, { status: 400 });
  }

  const date = new Date(body.date);
  if (Number.isNaN(+date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });

  const rawDescription = (body.rawDescription ?? body.merchant ?? 'Manual entry').trim();
  const merchant = body.merchant ? normalizeMerchant(body.merchant) : null;
  const hash = txnHash({ accountId: body.accountId, date, amount: body.amount, rawDescription });

  const currency = (body.currency ?? BASE_CURRENCY).toUpperCase();
  let baseAmount: number | null = null;
  if (currency !== BASE_CURRENCY) {
    const conv = await toBase(body.amount, currency, date);
    if (conv) baseAmount = conv.base;
  }

  try {
    const tx = await prisma.transaction.create({
      data: {
        accountId: body.accountId,
        date, amount: body.amount,
        currency, baseAmount,
        rawDescription, merchant, hash,
        notes: body.notes || null,
        isAnticipated: body.isAnticipated === true,
        ...(body.tagIds?.length ? { tags: { connect: body.tagIds.map(id => ({ id })) } } : {}),
      },
      select: { id: true, uuid: true, isAnticipated: true },
    });
    // Auto-pair transfers if this is a real entry (not an anticipated placeholder).
    if (!tx.isAnticipated) {
      const { pairCrossAccountTransfers } = await import('@/lib/transferPairing');
      pairCrossAccountTransfers({ rangeDays: 3 }).catch(() => null); // fire-and-forget; don't block the response
    }
    return NextResponse.json({ ok: true, transaction: tx });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
