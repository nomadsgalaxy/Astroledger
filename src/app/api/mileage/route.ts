import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 2026 IRS standard mileage rate for business use.
const DEFAULT_RATE = 0.67;

export async function GET() {
  const logs = await prisma.mileageLog.findMany({
    orderBy: { date: 'desc' },
    take: 500,
  });
  return NextResponse.json({ logs });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{
    date: string; miles: number; purpose: string; ratePerMile: number;
    tagId: string | null; categoryId: string | null; notes: string | null;
  }>;
  if (!body.date || !body.miles || !body.purpose) {
    return NextResponse.json({ error: 'date, miles, purpose required' }, { status: 400 });
  }
  const log = await prisma.mileageLog.create({
    data: {
      date: new Date(body.date),
      miles: body.miles,
      purpose: body.purpose,
      ratePerMile: body.ratePerMile ?? DEFAULT_RATE,
      tagId: body.tagId ?? null,
      categoryId: body.categoryId ?? null,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ log });
}
