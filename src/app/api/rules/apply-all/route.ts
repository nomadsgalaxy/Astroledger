import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { applyRulesToAll } from '@/lib/rules';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/rules/apply-all  body: { sinceDays?: number }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { sinceDays?: number };
  const r = await applyRulesToAll({ sinceDays: body.sinceDays });
  return NextResponse.json({ ok: true, ...r });
}
