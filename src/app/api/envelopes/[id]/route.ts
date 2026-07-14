import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  for (const k of ['name', 'allocated', 'scope', 'tagId', 'categoryId', 'rollover', 'sortOrder', 'notes', 'monthYear'] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const env = await prisma.envelope.update({ where: { id }, data });
  return NextResponse.json({ envelope: env });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.envelope.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
