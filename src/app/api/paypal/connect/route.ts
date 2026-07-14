import { NextRequest, NextResponse } from 'next/server';
import { connectPayPal } from '@/lib/paypal';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';
import { requireSessionAndVault } from '@/lib/guards';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const guard = await requireSessionAndVault();
  if (guard instanceof NextResponse) return guard;
  try {
    const { name, clientId, secret, env, sinceDays } = await req.json();
    if (!clientId || !secret) return NextResponse.json({ error: 'clientId + secret required' }, { status: 400 });
    const envChoice: 'live' | 'sandbox' = env === 'sandbox' ? 'sandbox' : 'live';
    const out = await connectPayPal(name || 'PayPal', { clientId, secret, env: envChoice }, sinceDays ?? 90);
    await detectSubscriptions();
    await buildRecommendations();
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
