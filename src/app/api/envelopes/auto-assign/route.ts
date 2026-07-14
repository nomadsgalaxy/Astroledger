// POST /api/envelopes/auto-assign — fund each envelope in a month to its
// trailing-average spend ("budget what you typically spend"). Two modes:
//
//   { monthYear, apply: false }  → returns suggestions only (preview)
//   { monthYear, apply: true }   → writes suggested allocations, returns the
//                                   applied set + recomputed Ready-to-Assign
//
// Optional `lookback` (months, default 3, clamped 1..12).
//
// Auth: gated by the edge middleware, same as sibling /api/envelopes routes.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { suggestAllocations, getReadyToAssign } from '@/lib/envelopes';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<{ monthYear: string; apply: boolean; lookback: number }>;
  if (!body.monthYear || !/^\d{4}-\d{2}$/.test(body.monthYear)) {
    return NextResponse.json({ error: 'monthYear "YYYY-MM" is required' }, { status: 400 });
  }
  const lookback = Math.max(1, Math.min(12, body.lookback ?? 3));
  const suggestions = await suggestAllocations(body.monthYear, lookback);

  if (!body.apply) {
    return NextResponse.json({ applied: false, lookback, suggestions });
  }

  // Apply: only update rows whose suggestion differs from the current value.
  let updated = 0;
  for (const s of suggestions) {
    if (Math.abs(s.suggested - s.allocated) < 0.005) continue;
    await prisma.envelope.update({ where: { id: s.id }, data: { allocated: s.suggested } });
    updated++;
  }
  const readyToAssign = await getReadyToAssign(body.monthYear);
  return NextResponse.json({ applied: true, lookback, updated, suggestions, readyToAssign });
}
