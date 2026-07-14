import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { invalidateRulesCache } from '@/lib/rules';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rules = await prisma.rule.findMany({ orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.matchValue) return NextResponse.json({ error: 'name and matchValue required' }, { status: 400 });
  const rule = await prisma.rule.create({
    data: {
      name: String(body.name),
      enabled: body.enabled !== false,
      matchType: body.matchType === 'regex' ? 'regex' : 'substring',
      matchField: body.matchField === 'merchant' ? 'merchant' : 'rawDescription',
      matchValue: String(body.matchValue),
      caseInsensitive: body.caseInsensitive !== false,
      accountIds: body.accountIds ? JSON.stringify(body.accountIds) : null,
      minAmount: typeof body.minAmount === 'number' ? body.minAmount : null,
      maxAmount: typeof body.maxAmount === 'number' ? body.maxAmount : null,
      applyTagIds: body.applyTagIds ? JSON.stringify(body.applyTagIds) : null,
      applyCategory: body.applyCategory || null,
      applyIsTransfer: typeof body.applyIsTransfer === 'boolean' ? body.applyIsTransfer : null,
      applyMerchant: body.applyMerchant || null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
    },
  });
  invalidateRulesCache();
  return NextResponse.json({ rule });
}
