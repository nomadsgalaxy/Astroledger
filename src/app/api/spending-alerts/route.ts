import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const alerts = await prisma.spendingAlert.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ alerts });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{
    scope: 'tag' | 'category' | 'overall'; tagId: string | null; categoryId: string | null;
    monthlyCap: number; warnPct: number; enabled: boolean;
  }>;
  if (!body.scope || !body.monthlyCap || body.monthlyCap <= 0) {
    return NextResponse.json({ error: 'scope and monthlyCap>0 required' }, { status: 400 });
  }
  const alert = await prisma.spendingAlert.create({
    data: {
      scope: body.scope,
      tagId: body.scope === 'tag' ? (body.tagId ?? null) : null,
      categoryId: body.scope === 'category' ? (body.categoryId ?? null) : null,
      monthlyCap: body.monthlyCap,
      warnPct: body.warnPct ?? 0.8,
      enabled: body.enabled ?? true,
    },
  });
  return NextResponse.json({ alert });
}
