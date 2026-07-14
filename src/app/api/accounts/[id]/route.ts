import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { KIND_LABELS, type AccountKind } from '@/lib/accountKind';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if (body.kind !== undefined) {
    if (body.kind === null || body.kind === '') {
      data.kind = null;       // clear → fall back to inferred
    } else if ((body.kind as AccountKind) in KIND_LABELS) {
      data.kind = body.kind;
    } else {
      return NextResponse.json({ error: `Invalid kind: ${body.kind}` }, { status: 400 });
    }
  }
  if (typeof body.name === 'string') data.name = body.name.slice(0, 200);
  // Debt-payoff planner inputs (v0.5.0). Accept a number or null (clear).
  if (body.apr !== undefined) {
    if (body.apr === null) data.apr = null;
    else if (typeof body.apr === 'number' && Number.isFinite(body.apr) && body.apr >= 0 && body.apr <= 100) data.apr = body.apr;
    else return NextResponse.json({ error: 'apr must be a number between 0 and 100' }, { status: 400 });
  }
  if (body.minimumPayment !== undefined) {
    if (body.minimumPayment === null) data.minimumPayment = null;
    else if (typeof body.minimumPayment === 'number' && Number.isFinite(body.minimumPayment) && body.minimumPayment >= 0) data.minimumPayment = body.minimumPayment;
    else return NextResponse.json({ error: 'minimumPayment must be a non-negative number' }, { status: 400 });
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  const updated = await prisma.bankAccount.update({ where: { id }, data });
  return NextResponse.json({ account: updated });
}
