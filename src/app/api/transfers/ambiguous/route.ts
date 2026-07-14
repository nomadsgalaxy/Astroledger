import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { findAmbiguousTransfers } from '@/lib/transferReview';

export const runtime = 'nodejs';

// GET /api/transfers/ambiguous?rangeDays=3 → list of candidate groups
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rangeDays = parseInt(new URL(req.url).searchParams.get('rangeDays') ?? '3', 10);
  const groups = await findAmbiguousTransfers({ rangeDays });
  return NextResponse.json({ groups, total: groups.length });
}
