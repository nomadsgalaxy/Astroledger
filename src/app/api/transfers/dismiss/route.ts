import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { dismissPairingCandidates } from '@/lib/transferReview';

export const runtime = 'nodejs';

// POST /api/transfers/dismiss
// Body: { txIds: string[] }   marks each as pairingDismissed=true so the
// matcher stops suggesting them. Used by "Not a transfer" button.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as null | { txIds?: string[] };
  if (!body || !Array.isArray(body.txIds) || body.txIds.length === 0) {
    return NextResponse.json({ error: 'txIds (string[]) required' }, { status: 400 });
  }
  const r = await dismissPairingCandidates(body.txIds);
  return NextResponse.json({ ok: true, ...r });
}
