// POST /api/holdings/refresh-prices → fetch live quotes for ticker holdings,
// update marketValue + write SecurityPrice points. Auth via the edge middleware.
import { NextResponse } from 'next/server';
import { refreshHoldingPrices } from '@/lib/securityPrices';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  const result = await refreshHoldingPrices();
  return NextResponse.json(result);
}
