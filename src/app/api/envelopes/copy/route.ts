import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Copy all envelopes from `fromMonth` to `toMonth`. Skips ones that already
// exist in the target month (idempotent - re-run is safe).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { fromMonth?: string; toMonth?: string };
  if (!body.fromMonth || !body.toMonth) {
    return NextResponse.json({ error: 'fromMonth and toMonth required' }, { status: 400 });
  }
  const [src, existing] = await Promise.all([
    prisma.envelope.findMany({ where: { monthYear: body.fromMonth } }),
    prisma.envelope.findMany({ where: { monthYear: body.toMonth }, select: { name: true } }),
  ]);
  const existingNames = new Set(existing.map(e => e.name));
  const toCreate = src.filter(s => !existingNames.has(s.name));
  for (const s of toCreate) {
    await prisma.envelope.create({
      data: {
        monthYear: body.toMonth,
        name: s.name,
        allocated: s.allocated,
        scope: s.scope,
        tagId: s.tagId,
        categoryId: s.categoryId,
        rollover: s.rollover,
        sortOrder: s.sortOrder,
        notes: s.notes,
      },
    });
  }
  return NextResponse.json({ copied: toCreate.length, skipped: src.length - toCreate.length });
}
