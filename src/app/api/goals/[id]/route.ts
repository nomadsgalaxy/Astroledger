import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  for (const k of ['name', 'kind', 'notes', 'status']) if (body[k] !== undefined) data[k] = body[k];
  for (const k of ['targetAmount', 'currentAmount']) if (body[k] !== undefined) data[k] = Number(body[k]);
  if (body.deadline !== undefined) data.deadline = body.deadline ? new Date(body.deadline) : null;
  // Auto-promote to achieved if currentAmount >= targetAmount
  if (data.currentAmount !== undefined) {
    const g = await prisma.goal.findUnique({ where: { id } });
    if (g && data.currentAmount >= (data.targetAmount ?? g.targetAmount) && g.status === 'active') {
      data.status = 'achieved';
    }
  }
  return NextResponse.json({ goal: await prisma.goal.update({ where: { id }, data }) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
