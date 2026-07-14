import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { captureNetWorthSnapshot, listNetWorthHistory } from '@/lib/netWorthSnapshot';

export const runtime = 'nodejs';

// GET /api/networth/snapshot?days=365 - historical series
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = parseInt(new URL(req.url).searchParams.get('days') ?? '365', 10);
  const history = await listNetWorthHistory({ days });
  return NextResponse.json({ history });
}

// POST /api/networth/snapshot - capture (or overwrite) today's snapshot
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await captureNetWorthSnapshot();
  return NextResponse.json(r);
}
