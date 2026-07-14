// POST   /api/scenarios/:id/adjustments        → add { label, monthlyDelta }
// DELETE /api/scenarios/:id/adjustments?adj=ID  → remove one adjustment
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scenarioRunway } from '@/lib/scenarios';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { label?: string; monthlyDelta?: number };
  const label = (body.label ?? '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (typeof body.monthlyDelta !== 'number' || !Number.isFinite(body.monthlyDelta)) {
    return NextResponse.json({ error: 'monthlyDelta (number) is required' }, { status: 400 });
  }
  const exists = await prisma.scenario.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  await prisma.scenarioAdjustment.create({
    data: { scenarioId: id, label: label.slice(0, 120), monthlyDelta: Math.round(body.monthlyDelta * 100) / 100 },
  });
  return NextResponse.json({ runway: await scenarioRunway(id) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const adjId = new URL(req.url).searchParams.get('adj');
  if (!adjId) return NextResponse.json({ error: 'adj query param required' }, { status: 400 });
  await prisma.scenarioAdjustment.deleteMany({ where: { id: adjId, scenarioId: id } });
  return NextResponse.json({ runway: await scenarioRunway(id) });
}
