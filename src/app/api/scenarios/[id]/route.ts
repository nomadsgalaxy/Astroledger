// PATCH  /api/scenarios/:id   → { active?, name? }  (toggle into the headline, rename)
// DELETE /api/scenarios/:id   → remove the scenario (cascades adjustments)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scenarioRunway } from '@/lib/scenarios';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { active?: boolean; name?: string };
  const data: { active?: boolean; name?: string } = {};
  if (typeof body.active === 'boolean') data.active = body.active;
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  try {
    const scenario = await prisma.scenario.update({ where: { id }, data, include: { adjustments: true } });
    return NextResponse.json({ scenario, runway: await scenarioRunway(id) });
  } catch {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.scenario.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }
}
