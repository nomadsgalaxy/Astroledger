import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { setTxCategories, setTxCategory } from '@/lib/autoCategorize';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { txId?: string; txIds?: string[]; category?: string | null } | null;
  const txIds = body?.txIds?.filter((id): id is string => typeof id === 'string' && id.length > 0) ?? [];
  if (!body?.txId && txIds.length === 0) return NextResponse.json({ error: 'txId or txIds required' }, { status: 400 });
  if (txIds.length > 500) return NextResponse.json({ error: 'At most 500 transactions can be updated at once' }, { status: 400 });

  try {
    const updated = txIds.length > 0
      ? await setTxCategories(txIds, body?.category ?? null)
      : (await setTxCategory(body!.txId!, body?.category ?? null), 1);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
