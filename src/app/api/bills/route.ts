import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBillDashboard } from '@/lib/bills';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getBillDashboard());
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  const cadenceDays = typeof body.cadenceDays === 'number' ? body.cadenceDays : Number(body.cadenceDays ?? 30);
  const dueDate = typeof body.nextDate === 'string' ? new Date(body.nextDate) : new Date();
  const amountMode = body.amountMode === 'variable' ? 'variable' : 'fixed';
  const autopay = body.autopay === true;

  if (!name) return NextResponse.json({ error: 'Bill name is required' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Expected amount must be greater than zero' }, { status: 400 });
  if (!Number.isFinite(cadenceDays) || cadenceDays < 1 || cadenceDays > 3660) return NextResponse.json({ error: 'Cadence is invalid' }, { status: 400 });
  if (Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: 'Due date is invalid' }, { status: 400 });

  const schedule = await prisma.schedule.create({
    data: {
      name: name.slice(0, 120),
      amount: -Math.round(amount * 100) / 100,
      cadenceDays: Math.round(cadenceDays),
      nextDate: dueDate,
      amountMode,
      autopay,
    },
  });
  return NextResponse.json({ schedule, dashboard: await getBillDashboard() }, { status: 201 });
}
