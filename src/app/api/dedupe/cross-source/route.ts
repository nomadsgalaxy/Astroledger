import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { dedupeCrossSource } from '@/lib/crossSourceDedup';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/dedupe/cross-source
// Body: { dryRun?: boolean }    default applies the dedup.
// Finds transactions on the same account/day/amount where ONE row has a
// plaidTxId (live connector source) and the OTHER doesn't (file import).
// Keeps the live one, deletes the file copy, preserves receipts + tags.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    dryRun?: boolean;
    dayWindow?: number;
    allowCrossAccount?: boolean;
  };
  const result = await dedupeCrossSource({
    dryRun: body.dryRun === true,
    dayWindow: typeof body.dayWindow === 'number' ? body.dayWindow : undefined,
    allowCrossAccount: body.allowCrossAccount === true,
  });
  return NextResponse.json(result);
}
