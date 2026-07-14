import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getInactiveMonths, setInactiveMonths } from '@/lib/inactiveAccounts';
import { getRequestFinancialAccess } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET  /api/settings/inactive-accounts → { months: number }
// POST /api/settings/inactive-accounts → { months: number } (0 disables)
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ months: await getInactiveMonths() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await getRequestFinancialAccess())?.canCreate) return NextResponse.json({ error: 'Manage permission is required' }, { status: 403 });
  const body = await req.json().catch(() => null) as { months?: number } | null;
  if (!body || typeof body.months !== 'number' || !Number.isFinite(body.months)) {
    return NextResponse.json({ error: 'months (number, 0 to disable) required' }, { status: 400 });
  }
  await setInactiveMonths(body.months);
  return NextResponse.json({ months: await getInactiveMonths() });
}
