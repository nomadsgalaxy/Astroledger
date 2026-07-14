// Generic order-ingestion endpoint used by the (future) browser extension.
// POST { source, externalId, merchant, orderDate, amount, items?, url? }
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { matchOrders } from '@/lib/orderMatcher';
import { activeFinancialSpaceId } from '@/lib/spaceContext';

const Body = z.object({
  source: z.string(),
  externalId: z.string().optional(),
  merchant: z.string(),
  orderDate: z.string(),
  amount: z.number(),
  currency: z.string().optional(),
  items: z.array(z.object({ name: z.string(), qty: z.number().optional(), price: z.number().optional() })).optional(),
  url: z.string().optional(),
});

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const spaceId = await activeFinancialSpaceId();
  const json = await req.json();
  const parse = Body.safeParse(json);
  if (!parse.success) return NextResponse.json({ error: parse.error.flatten() }, { status: 400 });
  const o = parse.data;
  try {
    const order = await prisma.order.upsert({
      where: { spaceId_source_externalId: { spaceId, source: o.source, externalId: o.externalId ?? '' } },
      create: {
        spaceId, source: o.source, externalId: o.externalId, merchant: o.merchant,
        orderDate: new Date(o.orderDate), amount: o.amount, currency: o.currency ?? 'USD',
        items: o.items ? JSON.stringify(o.items) : null, url: o.url,
      },
      update: { amount: o.amount, items: o.items ? JSON.stringify(o.items) : null },
    });
    const m = await matchOrders({ onlyOrderId: order.id });
    return NextResponse.json({ orderId: order.id, matched: m.matched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
