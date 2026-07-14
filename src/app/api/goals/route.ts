import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const goal = await prisma.goal.create({
    data: {
      name: body.name,
      kind: body.kind, // savings | debt_payoff | spend_under
      targetAmount: Number(body.targetAmount),
      currentAmount: Number(body.currentAmount ?? 0),
      deadline: body.deadline ? new Date(body.deadline) : null,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ goal });
}
