import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { runForecasts } from '@/lib/forecast';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const out = await runForecasts(12);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
