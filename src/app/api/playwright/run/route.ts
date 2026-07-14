// Trigger a Playwright adapter run. The Astroledger server spawns the runner as
// a child process (it needs a real GUI window for the user to supervise),
// passing credentials via env. Stdout is parsed as JSON order drafts and
// upserted into the Order table.

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { matchOrders } from '@/lib/orderMatcher';
import { activeFinancialSpaceId } from '@/lib/spaceContext';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const spaceId = await activeFinancialSpaceId();
  const body = await req.json();
  const adapterId = String(body.adapterId ?? '');
  if (!/^[a-z0-9_-]+$/i.test(adapterId)) return NextResponse.json({ error: 'Bad adapterId' }, { status: 400 });

  // Credentials come from an encrypted-at-rest Institution row (source=playwright:<id>).
  const inst = await prisma.institution.findFirst({ where: { source: `playwright:${adapterId}` } });
  if (!inst?.accessToken) return NextResponse.json({ error: 'No creds configured for this adapter' }, { status: 400 });

  const runner = path.resolve(process.cwd(), 'playwright', 'runner.ts');
  const child = spawn('npx', ['tsx', runner, adapterId], {
    env: { ...process.env, ASTROLEDGER_PLAYWRIGHT_CREDS: inst.accessToken, ASTROLEDGER_PLAYWRIGHT_SINCE_DAYS: String(body.sinceDays ?? 90) },
    shell: true,
  });
  let out = '', err = '';
  child.stdout.on('data', d => out += d.toString());
  child.stderr.on('data', d => err += d.toString());
  const code: number = await new Promise(resolve => child.on('close', resolve as any));
  if (code !== 0) return NextResponse.json({ error: err.slice(0, 500) || 'Playwright runner failed' }, { status: 500 });

  let orders: any[] = [];
  try { orders = JSON.parse(out); } catch { return NextResponse.json({ error: 'Could not parse runner output' }, { status: 500 }); }

  let upserted = 0;
  for (const o of orders) {
    try {
      await prisma.order.upsert({
        where: { spaceId_source_externalId: { spaceId, source: o.source, externalId: o.externalId ?? '' } },
        create: {
          spaceId, source: o.source, externalId: o.externalId ?? null, merchant: o.merchant,
          orderDate: new Date(o.orderDate), amount: Number(o.amount), currency: 'USD',
          items: o.items ? JSON.stringify(o.items) : null, url: o.url,
        },
        update: { amount: Number(o.amount) },
      });
      upserted++;
    } catch {}
  }
  const m = await matchOrders();
  return NextResponse.json({ adapterId, capturedCount: orders.length, upserted, matched: m.matched, stderr: err.slice(0, 500) });
}
