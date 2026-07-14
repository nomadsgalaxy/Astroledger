import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  for (const k of ['scope', 'tagId', 'categoryId', 'monthlyCap', 'warnPct', 'enabled'] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const alert = await prisma.spendingAlert.update({ where: { id }, data });
  return NextResponse.json({ alert });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.spendingAlert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
