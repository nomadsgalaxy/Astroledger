import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDefaultBuckets } from '@/lib/taxBuckets';

export async function GET() {
  await ensureDefaultBuckets();
  const buckets = await prisma.taxBucket.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ buckets });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{
    scheduleLine: string; name: string; matchers: any; notes: string | null; sortOrder: number;
  }>;
  if (!body.scheduleLine || !body.name) {
    return NextResponse.json({ error: 'scheduleLine and name required' }, { status: 400 });
  }
  const bucket = await prisma.taxBucket.create({
    data: {
      scheduleLine: body.scheduleLine,
      name: body.name,
      matchers: JSON.stringify(body.matchers ?? []),
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 100,
    },
  });
  return NextResponse.json({ bucket });
}
