// Monthly cron endpoint. Authenticated via CRON_SECRET in Authorization header,
// so external schedulers (Windows Task Scheduler, cron, GitHub Actions) can hit it.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:5050/api/cron/monthly
//
// Runs: refresh forecast, re-detect subscriptions, rebuild recommendations.
// Vault is NOT unlocked by this path (no user session) - so reads of encrypted
// fields (Plaid/SimpleFIN/PayPal credentials) will return null, which means
// connector syncs are NOT triggered. That's intentional: cron just refreshes
// derived data from already-imported transactions.

import { NextRequest, NextResponse } from 'next/server';
import { runForecasts } from '@/lib/forecast';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  return token === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const start = Date.now();
  const forecasts = await runForecasts(12);
  const subs = await detectSubscriptions();
  const recs = await buildRecommendations();
  return NextResponse.json({
    ok: true, durationMs: Date.now() - start,
    forecasts, subscriptions: subs, recommendations: recs,
  });
}
