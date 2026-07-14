// Auto Gmail sync controller.
//   GET  → returns config + last run stats
//   POST → updates config (any subset of: enabled, intervalMin, maxPerRun, lookbackDays, useLlm)
//          OR { runNow: true } to fire one cycle immediately

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { readConfig, writeConfig, runAutoSync, readLastRun, initSchedulerOnce } from '@/lib/gmailScheduler';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await initSchedulerOnce();
  const [config, last] = await Promise.all([readConfig(), readLastRun()]);
  return NextResponse.json({ config, ...last });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  if (body.runNow) {
    try {
      const stats = await runAutoSync();
      return NextResponse.json({ ok: true, stats });
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
    }
  }

  const config = await writeConfig({
    enabled:      typeof body.enabled === 'boolean' ? body.enabled : undefined,
    intervalMin:  body.intervalMin !== undefined ? Math.max(5, Math.min(1440, parseInt(body.intervalMin))) : undefined,
    maxPerRun:    body.maxPerRun   !== undefined ? Math.max(1, Math.min(500,  parseInt(body.maxPerRun)))   : undefined,
    lookbackDays: body.lookbackDays !== undefined ? Math.max(1, Math.min(365, parseInt(body.lookbackDays))) : undefined,
    useLlm:       typeof body.useLlm === 'boolean' ? body.useLlm : undefined,
  });
  await initSchedulerOnce();
  return NextResponse.json({ config });
}
