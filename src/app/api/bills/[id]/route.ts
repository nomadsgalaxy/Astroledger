import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const occurrence = await prisma.billOccurrence.findUnique({ where: { id } });
  if (!occurrence) return NextResponse.json({ error: 'Bill occurrence not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!['upcoming', 'paid', 'skipped'].includes(String(body.status))) {
      return NextResponse.json({ error: 'Invalid bill status' }, { status: 400 });
    }
    data.status = body.status;
    if (body.status === 'upcoming' || body.status === 'skipped') {
      data.transactionId = null;
      data.paidAt = null;
    }
    if (body.status === 'paid') {
      if (typeof body.transactionId === 'string' && body.transactionId) {
        const tx = await prisma.transaction.findUnique({ where: { id: body.transactionId }, select: { id: true, amount: true, date: true } });
        if (!tx || tx.amount >= 0) return NextResponse.json({ error: 'Payment transaction is invalid' }, { status: 400 });
        const alreadyClaimed = await prisma.billOccurrence.findFirst({ where: { transactionId: tx.id, id: { not: id } }, select: { id: true } });
        if (alreadyClaimed) return NextResponse.json({ error: 'That transaction is already linked to another bill' }, { status: 409 });
        data.transactionId = tx.id;
        data.paidAt = tx.date;
      } else {
        data.transactionId = null;
        data.paidAt = new Date();
      }
    }
  }

  if (body.dueDate !== undefined) {
    const dueDate = new Date(String(body.dueDate));
    if (Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: 'Due date is invalid' }, { status: 400 });
    data.dueDate = dueDate;
  }
  if (body.expectedAmount !== undefined) {
    const expectedAmount = Number(body.expectedAmount);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return NextResponse.json({ error: 'Expected amount must be greater than zero' }, { status: 400 });
    data.expectedAmount = Math.round(expectedAmount * 100) / 100;
  }

  const sourceData: { amountMode?: string; autopay?: boolean } = {};
  if (body.amountMode !== undefined) {
    if (!['fixed', 'variable'].includes(String(body.amountMode))) return NextResponse.json({ error: 'Invalid amount mode' }, { status: 400 });
    data.amountMode = body.amountMode;
    sourceData.amountMode = String(body.amountMode);
  }
  if (body.autopay !== undefined) {
    if (typeof body.autopay !== 'boolean') return NextResponse.json({ error: 'autopay must be a boolean' }, { status: 400 });
    data.autopay = body.autopay;
    sourceData.autopay = body.autopay;
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  try {
    const updated = await prisma.$transaction(async tx => {
      if (Object.keys(sourceData).length && occurrence.sourceType === 'subscription') {
        await tx.subscription.update({ where: { id: occurrence.sourceId }, data: sourceData }).catch(() => null);
        await tx.billOccurrence.updateMany({ where: { sourceType: 'subscription', sourceId: occurrence.sourceId, status: 'upcoming' }, data: sourceData });
      }
      if (Object.keys(sourceData).length && occurrence.sourceType === 'schedule') {
        await tx.schedule.update({ where: { id: occurrence.sourceId }, data: sourceData }).catch(() => null);
        await tx.billOccurrence.updateMany({ where: { sourceType: 'schedule', sourceId: occurrence.sourceId, status: 'upcoming' }, data: sourceData });
      }
      return tx.billOccurrence.update({ where: { id }, data });
    });
    return NextResponse.json({ occurrence: updated });
  } catch {
    return NextResponse.json({ error: 'The update conflicts with another occurrence' }, { status: 409 });
  }
}
