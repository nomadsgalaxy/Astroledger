import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listReceiptMessageIds, fetchMessage } from '@/lib/gmail';
import { parseReceipt } from '@/lib/receiptParse';
import { prisma } from '@/lib/prisma';
import { matchOrders } from '@/lib/orderMatcher';
import { activeFinancialSpaceId } from '@/lib/spaceContext';

export const runtime = 'nodejs';
export const maxDuration = 300; // long sync

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const spaceId = await activeFinancialSpaceId();
  const userId = (session.user as any).id as string;
  const body = await req.json().catch(() => ({}));
  const sinceDays = Math.min(Math.max(parseInt(body.sinceDays ?? '90'), 1), 365);
  const max = Math.min(parseInt(body.max ?? '250'), 500);

  let ids: string[];
  try { ids = await listReceiptMessageIds(userId, { sinceDays, max }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }); }

  // Skip messages we've already imported
  const existing = await prisma.order.findMany({
    where: { source: 'gmail', externalId: { in: ids } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map(e => e.externalId));
  const todo = ids.filter(id => !seen.has(id));

  // Fetch messages in parallel batches - Gmail allows ~50 req/sec/user.
  // We chunk 10 at a time which keeps us well under that and 10× faster than serial.
  const BATCH = 10;
  let imported = 0, skipped = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(async id => {
      const msg = await fetchMessage(userId, id);
      const draft = parseReceipt(msg);
      if (!draft) return 'skipped' as const;
      await prisma.order.upsert({
        where: { spaceId_source_externalId: { spaceId, source: 'gmail', externalId: id } },
        create: {
          spaceId, source: 'gmail', externalId: id, merchant: draft.merchant,
          orderDate: draft.orderDate, amount: draft.amount, currency: draft.currency,
          items: draft.items ? JSON.stringify(draft.items) : null,
          url: draft.url,
        },
        update: { amount: draft.amount, merchant: draft.merchant },
      });
      return 'imported' as const;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'imported') imported++; else skipped++;
      } else failed++;
    }
  }

  const m = await matchOrders();
  await prisma.appSetting.upsert({
    where: { key: 'gmail_last_sync' },
    update: { value: new Date().toISOString() },
    create: { key: 'gmail_last_sync', value: new Date().toISOString() },
  });

  return NextResponse.json({ scanned: ids.length, alreadyImported: seen.size, imported, skipped, failed, matched: m.matched });
}
