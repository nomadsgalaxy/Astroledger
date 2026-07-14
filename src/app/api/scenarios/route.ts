// GET  /api/scenarios  → all scenarios (with adjustments) + the headline runway
// POST /api/scenarios  → create a scenario { name }
// Auth via the edge middleware (unauthenticated /api/* → 401).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { headlineRunway } from '@/lib/scenarios';

export const runtime = 'nodejs';

export async function GET() {
  const [scenarios, runway] = await Promise.all([
    prisma.scenario.findMany({ include: { adjustments: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    headlineRunway(),
  ]);
  return NextResponse.json({ scenarios, runway });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const scenario = await prisma.scenario.create({ data: { name: name.slice(0, 120) } });
  return NextResponse.json({ scenario });
}
