import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { autoTag } from '@/lib/autoTag';
import { getRange } from '@/lib/timeRange.server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    mode?: 'untagged' | 'all';
    scope?: 'range' | 'allTime';
  };
  const range = await getRange();

  try {
    const result = await autoTag({
      mode: body.mode ?? 'untagged',
      since: body.scope === 'allTime' ? undefined : range.since,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
