import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pairCrossAccountTransfers } from '@/lib/transferPairing';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { rangeDays?: number };
  const result = await pairCrossAccountTransfers({ rangeDays: body.rangeDays });
  return NextResponse.json(result);
}
