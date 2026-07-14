import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  for (const k of ['scheduleLine', 'name', 'notes', 'sortOrder'] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.matchers !== undefined) data.matchers = JSON.stringify(body.matchers);
  const bucket = await prisma.taxBucket.update({ where: { id }, data });
  return NextResponse.json({ bucket });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.taxBucket.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
