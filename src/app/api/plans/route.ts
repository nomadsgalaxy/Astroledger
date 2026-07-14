import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPlanFromForecast, activatePlan, archivePlan } from '@/lib/plans';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const plans = await prisma.plan.findMany({
    orderBy: [{ status: 'asc' }, { periodStart: 'desc' }],
    include: { _count: { select: { lines: true } } },
  });
  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (body.action === 'createFromForecast') {
      const plan = await createPlanFromForecast({
        name: body.name ?? `Plan ${new Date().toLocaleDateString()}`,
        months: body.months ?? 12,
        activate: body.activate ?? false,
      });
      return NextResponse.json({ plan });
    }
    if (body.action === 'activate') return NextResponse.json({ plan: await activatePlan(body.planId) });
    if (body.action === 'archive')  return NextResponse.json({ plan: await archivePlan(body.planId) });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
