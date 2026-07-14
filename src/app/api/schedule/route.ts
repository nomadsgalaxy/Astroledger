// GET  /api/schedule → manual schedules + monthly commitments + upcoming events
// POST /api/schedule → create a manual recurring entry
// Auth via the edge middleware.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { monthlyCommitments, upcomingEvents } from '@/lib/schedule';

export const runtime = 'nodejs';

export async function GET() {
  const [schedules, commitments, upcoming] = await Promise.all([
    prisma.schedule.findMany({ orderBy: { nextDate: 'asc' } }),
    monthlyCommitments(),
    upcomingEvents(60),
  ]);
  return NextResponse.json({ schedules, commitments, upcoming });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { name?: string; amount?: number; cadenceDays?: number; nextDate?: string; notes?: string };
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount === 0) {
    return NextResponse.json({ error: 'amount (non-zero number; negative = expense) is required' }, { status: 400 });
  }
  const cadenceDays = Math.max(1, Math.round(body.cadenceDays ?? 30));
  const nextDate = body.nextDate ? new Date(body.nextDate) : new Date();
  if (isNaN(nextDate.getTime())) return NextResponse.json({ error: 'nextDate is invalid' }, { status: 400 });
  const schedule = await prisma.schedule.create({
    data: { name: name.slice(0, 120), amount: Math.round(body.amount * 100) / 100, cadenceDays, nextDate, notes: body.notes?.slice(0, 300) ?? null },
  });
  return NextResponse.json({ schedule });
}
