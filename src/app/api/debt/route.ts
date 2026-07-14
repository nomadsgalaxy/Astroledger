// GET /api/debt?budget=<monthly>  → debt-payoff plan (avalanche vs snowball)
// across all credit/loan accounts that have APR + minimum payment set.
// Auth via the edge middleware (unauthenticated /api/* → 401).
import { NextResponse } from 'next/server';
import { buildDebtPlan } from '@/lib/debt';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('budget');
  const budget = raw != null && raw !== '' ? Number(raw) : undefined;
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) {
    return NextResponse.json({ error: 'budget must be a non-negative number' }, { status: 400 });
  }
  const plan = await buildDebtPlan(budget);
  return NextResponse.json(plan);
}
