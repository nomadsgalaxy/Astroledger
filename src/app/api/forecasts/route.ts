import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/** Clear all forecasts (and their points via cascade). */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await prisma.forecast.deleteMany();
  return NextResponse.json({ ok: true, deleted: r.count });
}
