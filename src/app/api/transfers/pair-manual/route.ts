import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pairTransactionsManual } from '@/lib/transferReview';

export const runtime = 'nodejs';

// POST /api/transfers/pair-manual
// Body: { outflowId, inflowId }
// User-confirmed pairing - bypasses the ambiguity heuristic.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as null | { outflowId?: string; inflowId?: string };
  if (!body?.outflowId || !body?.inflowId) {
    return NextResponse.json({ error: 'outflowId and inflowId required' }, { status: 400 });
  }
  try {
    await pairTransactionsManual(body.outflowId, body.inflowId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
