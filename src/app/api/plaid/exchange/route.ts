import { NextRequest, NextResponse } from 'next/server';
import { exchangePublicToken, syncTransactions } from '@/lib/plaid';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';
import { requireSessionAndVault } from '@/lib/guards';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Same one-time-token concern as SimpleFIN - verify auth + vault before
  // exchanging the public_token so a locked vault doesn't burn the credential.
  const guard = await requireSessionAndVault();
  if (guard instanceof NextResponse) return guard;
  try {
    const { public_token, institution_name } = await req.json();
    if (!public_token) return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
    const inst = await exchangePublicToken(public_token, institution_name || 'Bank');
    const sync = await syncTransactions(inst.id);
    const subs = await detectSubscriptions();
    const recs = await buildRecommendations();
    return NextResponse.json({ institutionId: inst.id, ...sync, subscriptions: subs, recommendations: recs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
