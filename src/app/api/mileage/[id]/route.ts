import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  for (const k of ['date', 'miles', 'purpose', 'ratePerMile', 'tagId', 'categoryId', 'notes'] as const) {
    if (body[k] === undefined) continue;
    data[k] = k === 'date' && body[k] ? new Date(body[k]) : body[k];
  }
  const log = await prisma.mileageLog.update({ where: { id }, data });
  return NextResponse.json({ log });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.mileageLog.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST → materialize the log as an anticipated Transaction. Idempotent:
// once materialized (log.transactionId set), a re-POST is a no-op.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { accountId?: string };
  const log = await prisma.mileageLog.findUnique({ where: { id } });
  if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (log.transactionId) {
    return NextResponse.json({ log, alreadyMaterialized: true });
  }
  // Pick an account: the explicitly passed one, or the first non-credit asset
  // account (the user's daily-driver checking). Fall back to any account.
  const account = body.accountId
    ? await prisma.bankAccount.findUnique({ where: { id: body.accountId } })
    : await prisma.bankAccount.findFirst({
        where: { OR: [{ kind: 'checking' }, { type: 'depository' }] },
        orderBy: { createdAt: 'asc' },
      }) ?? await prisma.bankAccount.findFirst();
  if (!account) return NextResponse.json({ error: 'no account available' }, { status: 400 });

  const amount = -1 * Math.round(log.miles * log.ratePerMile * 100) / 100;
  // Hash includes the log id so this stays unique even if user fires twice.
  const hash = createHash('sha256').update(`mileage:${log.id}`).digest('hex');
  const tx = await prisma.transaction.create({
    data: {
      accountId: account.id,
      hash,
      date: log.date,
      amount,
      rawDescription: `Mileage: ${log.purpose} (${log.miles} mi × $${log.ratePerMile.toFixed(2)})`,
      merchant: 'Mileage reimbursement',
      isAnticipated: true,
      notes: log.notes ?? null,
      tags: log.tagId ? { connect: [{ id: log.tagId }] } : undefined,
      categoryId: log.categoryId ?? undefined,
    },
  });
  await prisma.mileageLog.update({ where: { id }, data: { transactionId: tx.id } });
  return NextResponse.json({ log: { ...log, transactionId: tx.id }, transactionId: tx.id });
}
