import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { mergeAccounts } from '@/lib/accountMerge';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/accounts/:id/merge
// Body: { intoAccountId: string }
// Merges this account INTO intoAccountId - moves all transactions/receipts/
// orders/goals over, deletes this account. Returns per-entity counts and the
// count of collision-dropped transactions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: sourceId } = await params;
  const body = await req.json().catch(() => null) as null | { intoAccountId: string };
  if (!body?.intoAccountId) return NextResponse.json({ error: 'intoAccountId required' }, { status: 400 });
  if (body.intoAccountId === sourceId) return NextResponse.json({ error: 'cannot merge into self' }, { status: 400 });

  try {
    const result = await mergeAccounts(sourceId, body.intoAccountId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
