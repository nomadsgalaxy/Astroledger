import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const monthYear = url.searchParams.get('monthYear') ?? undefined;
  const envelopes = await prisma.envelope.findMany({
    where: monthYear ? { monthYear } : undefined,
    orderBy: [{ monthYear: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json({ envelopes });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{
    monthYear: string; name: string; allocated: number;
    scope: 'tag' | 'category'; tagId: string | null; categoryId: string | null;
    rollover: boolean; sortOrder: number; notes: string | null;
  }>;
  if (!body.monthYear || !body.name || !body.allocated) {
    return NextResponse.json({ error: 'monthYear, name, allocated required' }, { status: 400 });
  }
  try {
    const env = await prisma.envelope.create({
      data: {
        monthYear: body.monthYear,
        name: body.name,
        allocated: body.allocated,
        scope: body.scope ?? 'tag',
        tagId: body.scope === 'category' ? null : (body.tagId ?? null),
        categoryId: body.scope === 'category' ? (body.categoryId ?? null) : null,
        rollover: body.rollover ?? false,
        sortOrder: body.sortOrder ?? 0,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json({ envelope: env });
  } catch (e: any) {
    if (String(e?.message ?? '').includes('Unique constraint')) {
      return NextResponse.json({ error: 'An envelope with that name already exists for this month' }, { status: 409 });
    }
    throw e;
  }
}
