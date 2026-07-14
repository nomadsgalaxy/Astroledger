import { NextResponse } from 'next/server';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';

export async function POST() {
  const subs = await detectSubscriptions();
  const recs = await buildRecommendations();
  return NextResponse.json({ subscriptions: subs, recommendations: recs });
}
