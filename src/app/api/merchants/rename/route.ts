import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// POST /api/merchants/rename
// Body: { fromMerchant, toMerchant }
// Renames every transaction with merchant === fromMerchant to toMerchant.
// rawDescription is NEVER touched - the original bank string stays intact.
// Use when the user edits one tx's merchant and wants to propagate to siblings.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as null | { fromMerchant?: string; toMerchant?: string };
  if (!body?.fromMerchant || typeof body.toMerchant !== 'string') {
    return NextResponse.json({ error: 'fromMerchant and toMerchant required' }, { status: 400 });
  }
  const from = body.fromMerchant.trim();
  const to   = body.toMerchant.trim();
  if (!from) return NextResponse.json({ error: 'fromMerchant cannot be empty' }, { status: 400 });
  if (from === to) return NextResponse.json({ ok: true, updated: 0 });

  const res = await prisma.transaction.updateMany({
    where: { merchant: from },
    data: { merchant: to },
  });
  return NextResponse.json({ ok: true, updated: res.count });
}
