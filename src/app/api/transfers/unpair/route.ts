import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { unpairTransfer } from '@/lib/transferReview';

export const runtime = 'nodejs';

// POST /api/transfers/unpair
// Body: { transferGroupId }   clears the pairing on both rows so they go back
// to being normal income/spending lines. Use when a confirmed pairing was wrong.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as null | { transferGroupId?: string };
  if (!body?.transferGroupId) return NextResponse.json({ error: 'transferGroupId required' }, { status: 400 });
  const r = await unpairTransfer(body.transferGroupId);
  return NextResponse.json({ ok: true, ...r });
}
