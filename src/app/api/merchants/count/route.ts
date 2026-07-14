import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET /api/merchants/count?merchant=<exact-name>
// Returns the count of transactions where Transaction.merchant equals the
// given value. Used by the merchant-rename UI to surface "Apply to N others".
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const merchant = new URL(req.url).searchParams.get('merchant');
  if (!merchant) return NextResponse.json({ error: 'merchant query param required' }, { status: 400 });
  const count = await prisma.transaction.count({ where: { merchant } });
  return NextResponse.json({ merchant, count });
}
