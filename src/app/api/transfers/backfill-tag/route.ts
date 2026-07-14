import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { backfillTransferTags } from '@/lib/transferTag';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/transfers/backfill-tag - one-shot to apply the Transfer tag to
// every isTransfer=true row that doesn't have it yet, and remove the tag
// from rows where isTransfer was later set to false (cleanup).
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await backfillTransferTags();
  return NextResponse.json({ ok: true, ...r });
}
