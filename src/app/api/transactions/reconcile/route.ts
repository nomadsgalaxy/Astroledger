import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileAnticipated } from '@/lib/anticipatedMatch';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/transactions/reconcile
// Body: { accountId?: string }  // omit to sweep every account with anticipated rows
//
// Runs the anticipated-vs-bank matcher. The matcher uses the local LLM if
// reachable, otherwise falls back to a tight amount+merchant heuristic.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { accountId?: string };
  const accountIds: string[] = body.accountId
    ? [body.accountId]
    : (await prisma.transaction.findMany({
        where: { isAnticipated: true },
        select: { accountId: true },
        distinct: ['accountId'],
      })).map(t => t.accountId);

  let examined = 0, merged = 0, flagged = 0;
  for (const id of accountIds) {
    const r = await reconcileAnticipated(id);
    examined += r.examined; merged += r.merged; flagged += r.flagged;
  }
  return NextResponse.json({ ok: true, accounts: accountIds.length, examined, merged, flagged });
}
