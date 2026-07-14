import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { huntTransaction } from '@/lib/huntTransaction';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await huntTransaction(id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
