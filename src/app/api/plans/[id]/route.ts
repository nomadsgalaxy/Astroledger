import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const plan = await prisma.plan.findUnique({ where: { id }, include: { lines: { orderBy: [{ scopeKey: 'asc' }, { month: 'asc' }] } } });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ plan });
}

// Update line amounts in bulk.
// Body: { lines: [{ id, amount }] }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (!Array.isArray(body.lines)) return NextResponse.json({ error: 'lines[] required' }, { status: 400 });
  for (const l of body.lines) {
    if (!l.id || typeof l.amount !== 'number') continue;
    const line = await prisma.planLine.findUnique({ where: { id: l.id } });
    if (!line || line.planId !== id) continue;
    await prisma.planLine.update({ where: { id: l.id }, data: { amount: l.amount, sourceMethod: 'manual' } });
  }
  return NextResponse.json({ ok: true, updated: body.lines.length });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await prisma.plan.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
