// Upload an email archive and parse it for receipts.
// Accepts: .eml (single email), .mbox (concatenated), .zip (Google Takeout, etc).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseEmailArchive } from '@/lib/emailArchive';
import { matchOrders } from '@/lib/orderMatcher';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';
import { activeFinancialSpaceId } from '@/lib/spaceContext';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const spaceId = await activeFinancialSpaceId();

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (file.size > 200 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 200 MB)' }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const { drafts, scanned, skipped, failed } = await parseEmailArchive(buf, file.name);

  let imported = 0, duplicates = 0;
  for (const { draft, messageId } of drafts) {
    try {
      await prisma.order.upsert({
        where: { spaceId_source_externalId: { spaceId, source: 'email_archive', externalId: `archive:${messageId}` } },
        create: {
          spaceId, source: 'email_archive', externalId: `archive:${messageId}`,
          merchant: draft.merchant, orderDate: draft.orderDate,
          amount: draft.amount, currency: draft.currency,
          items: draft.items ? JSON.stringify(draft.items) : null,
          url: draft.url,
        },
        update: { amount: draft.amount, merchant: draft.merchant },
      });
      imported++;
    } catch { duplicates++; }
  }

  const m = await matchOrders();
  await detectSubscriptions();
  await buildRecommendations();

  return NextResponse.json({
    scanned, recognized: drafts.length, imported, duplicates, skipped, failed,
    matched: m.matched,
  });
}
