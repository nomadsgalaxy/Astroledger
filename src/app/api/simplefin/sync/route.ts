import { NextRequest, NextResponse } from 'next/server';
import { syncSimpleFin } from '@/lib/simplefin';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const out = await syncSimpleFin({
      institutionId: body.institutionId,
      sinceDays: body.sinceDays ?? 365,
    });
    await detectSubscriptions();
    await buildRecommendations();
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
