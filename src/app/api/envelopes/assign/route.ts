// POST /api/envelopes/assign — move money into (or out of) an envelope for a
// month, addressed by NAME rather than id, creating the envelope if it doesn't
// exist yet. This is the zero-based-budgeting "give this dollar a job" verb;
// the MCP `assign_to_category` tool and the Ready-to-Assign UI both call it.
//
// Body:
//   monthYear: "YYYY-MM"            (required)
//   name:      string               (required — envelope name)
//   amount:    number               (required)
//   mode:      "set" | "delta"      (default "set")
//   scope?:    "tag" | "category"   (only used when creating)
//   tagId?, categoryId?:            (only used when creating)
//   rollover?: boolean              (only used when creating)
//
// Returns: { envelope, readyToAssign }  — the updated/created envelope plus the
// recomputed Ready-to-Assign so the caller can reflect it without a round-trip.
//
// Auth: gated by the edge middleware (any unauthenticated /api/* → 401), same
// as the sibling /api/envelopes routes.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getReadyToAssign } from '@/lib/envelopes';
import { activeFinancialSpaceId } from '@/lib/spaceContext';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const spaceId = await activeFinancialSpaceId();
  const body = await req.json().catch(() => ({})) as Partial<{
    monthYear: string; name: string; amount: number; mode: 'set' | 'delta';
    scope: 'tag' | 'category'; tagId: string | null; categoryId: string | null; rollover: boolean;
  }>;

  if (!body.monthYear || !/^\d{4}-\d{2}$/.test(body.monthYear)) {
    return NextResponse.json({ error: 'monthYear "YYYY-MM" is required' }, { status: 400 });
  }
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: 'amount (number) is required' }, { status: 400 });
  }
  const mode = body.mode === 'delta' ? 'delta' : 'set';
  const name = body.name.trim();
  const monthYear = body.monthYear;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const existing = await prisma.envelope.findUnique({ where: { spaceId_monthYear_name: { spaceId, monthYear, name } } });

  let envelope;
  if (existing) {
    const next = mode === 'delta' ? existing.allocated + body.amount : body.amount;
    if (next < 0) {
      return NextResponse.json({ error: `Allocation can't go below 0 (would be ${next.toFixed(2)})` }, { status: 400 });
    }
    envelope = await prisma.envelope.update({ where: { id: existing.id }, data: { allocated: round2(next) } });
  } else {
    // Creating: a delta from nothing is just that amount. Need a scope + target.
    const amount = round2(mode === 'delta' ? body.amount : body.amount);
    if (amount < 0) return NextResponse.json({ error: 'Cannot create an envelope with a negative allocation' }, { status: 400 });
    const scope = body.scope === 'category' ? 'category' : 'tag';
    if (scope === 'tag' && !body.tagId) {
      return NextResponse.json({ error: 'Creating a tag-scoped envelope requires tagId' }, { status: 400 });
    }
    if (scope === 'category' && !body.categoryId) {
      return NextResponse.json({ error: 'Creating a category-scoped envelope requires categoryId' }, { status: 400 });
    }
    envelope = await prisma.envelope.create({
      data: {
        spaceId, monthYear, name, allocated: amount, scope,
        tagId: scope === 'tag' ? body.tagId! : null,
        categoryId: scope === 'category' ? body.categoryId! : null,
        rollover: body.rollover ?? false,
      },
    });
  }

  const readyToAssign = await getReadyToAssign(monthYear);
  return NextResponse.json({ envelope, readyToAssign });
}
