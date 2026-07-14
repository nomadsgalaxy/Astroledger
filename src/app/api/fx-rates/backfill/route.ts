import { NextResponse } from 'next/server';
import { backfillBaseAmounts } from '@/lib/fx';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { sinceDays?: number };
  const result = await backfillBaseAmounts({ sinceDays: body.sinceDays });
  return NextResponse.json(result);
}
