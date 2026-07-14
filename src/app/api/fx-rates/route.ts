import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const rates = await prisma.fxRate.findMany({
    orderBy: [{ quote: 'asc' }, { date: 'desc' }],
    take: 500,
  });
  return NextResponse.json({ rates });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{
    date: string; quote: string; rate: number; source: string;
  }>;
  if (!body.date || !body.quote || !body.rate) {
    return NextResponse.json({ error: 'date, quote, rate required' }, { status: 400 });
  }
  const quote = body.quote.toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(quote)) {
    return NextResponse.json({ error: 'quote must be a 3-letter ISO code' }, { status: 400 });
  }
  // Upsert on (date, quote) - repeated calls with the same date+quote update
  // rather than fail. Lets users tweak yesterday's rate without juggling ids.
  const date = new Date(body.date);
  date.setUTCHours(0, 0, 0, 0);
  const rate = await prisma.fxRate.upsert({
    where: { date_quote: { date, quote } },
    create: { date, quote, rate: body.rate, source: body.source ?? 'manual' },
    update: { rate: body.rate, source: body.source ?? 'manual' },
  });
  return NextResponse.json({ rate });
}
