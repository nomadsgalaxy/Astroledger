import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { invalidateRulesCache } from '@/lib/rules';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  for (const k of ['name', 'matchValue', 'applyCategory', 'applyMerchant'] as const) {
    if (typeof body[k] === 'string') data[k] = body[k];
  }
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.caseInsensitive === 'boolean') data.caseInsensitive = body.caseInsensitive;
  if (body.matchType) data.matchType = body.matchType === 'regex' ? 'regex' : 'substring';
  if (body.matchField) data.matchField = body.matchField === 'merchant' ? 'merchant' : 'rawDescription';
  if (Array.isArray(body.accountIds)) data.accountIds = JSON.stringify(body.accountIds);
  if (Array.isArray(body.applyTagIds)) data.applyTagIds = JSON.stringify(body.applyTagIds);
  if (typeof body.minAmount === 'number' || body.minAmount === null) data.minAmount = body.minAmount;
  if (typeof body.maxAmount === 'number' || body.maxAmount === null) data.maxAmount = body.maxAmount;
  if (typeof body.applyIsTransfer === 'boolean' || body.applyIsTransfer === null) data.applyIsTransfer = body.applyIsTransfer;
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;
  await prisma.rule.update({ where: { id }, data });
  invalidateRulesCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await prisma.rule.delete({ where: { id } }).catch(() => null);
  invalidateRulesCache();
  return NextResponse.json({ ok: true });
}
