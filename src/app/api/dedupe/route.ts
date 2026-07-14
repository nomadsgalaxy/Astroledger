import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { dedupAll, dedupTags, dedupSubscriptions, dedupCrossSourceTransactions } from '@/lib/dedupe';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { scope?: 'all' | 'tags' | 'subscriptions' | 'transactions' };
  try {
    switch (body.scope) {
      case 'tags':         return NextResponse.json({ tags: await dedupTags() });
      case 'subscriptions':return NextResponse.json({ subscriptions: await dedupSubscriptions() });
      case 'transactions': return NextResponse.json({ transactions: await dedupCrossSourceTransactions() });
      default:             return NextResponse.json(await dedupAll());
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
