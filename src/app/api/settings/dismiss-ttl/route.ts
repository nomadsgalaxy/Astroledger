import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDismissTtlDays, setDismissTtlDays } from '@/lib/dismissedRecs';
import { getRequestFinancialAccess } from '@/lib/prisma';

export const runtime = 'nodejs';

/** GET → { days: <current TTL> }.
 *  POST { days } → upserts the AppSetting, returns the value actually stored
 *  after clamping to [1, 365]. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ days: await getDismissTtlDays() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await getRequestFinancialAccess())?.canCreate) return NextResponse.json({ error: 'Manage permission is required' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { days?: number };
  if (typeof body.days !== 'number') {
    return NextResponse.json({ error: 'days must be a number' }, { status: 400 });
  }
  try {
    const stored = await setDismissTtlDays(body.days);
    return NextResponse.json({ ok: true, days: stored });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
