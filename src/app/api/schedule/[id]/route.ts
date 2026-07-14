// PATCH  /api/schedule/:id  → { active?, name?, amount?, cadenceDays?, nextDate? }
// DELETE /api/schedule/:id  → remove a manual recurring entry
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') data.active = body.active;
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount !== 0) data.amount = Math.round(body.amount * 100) / 100;
  if (typeof body.cadenceDays === 'number') data.cadenceDays = Math.max(1, Math.round(body.cadenceDays));
  if (typeof body.nextDate === 'string') { const d = new Date(body.nextDate); if (!isNaN(d.getTime())) data.nextDate = d; }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  try {
    const schedule = await prisma.schedule.update({ where: { id }, data });
    return NextResponse.json({ schedule });
  } catch {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.schedule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }
}
