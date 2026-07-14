import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readLastBackup } from '@/lib/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — liveness + readiness probe.
 *
 * Returns 200 only when a trivial DB query succeeds (the schema is present and
 * the connection works). Returns 503 otherwise, so the Docker HEALTHCHECK and
 * compose `depends_on: service_healthy` gate on real readiness rather than the
 * old proxy of "GET /api/auth/providers returned something."
 *
 * Unauthenticated by design (probes have no session) but it leaks nothing
 * sensitive — only liveness booleans + coarse ages. Cheap enough to poll.
 *
 * ?deep=1 adds non-fatal readiness signals (last-backup age) for dashboards/
 * external monitors; those never flip the top-level status to keep the probe
 * fast and the gate strict-but-narrow.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const deep = url.searchParams.get('deep') === '1';

  // Core readiness: a trivial query that requires the connection + schema.
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbOk = true;
  } catch (e) {
    dbError = (e as Error).message?.slice(0, 200) ?? 'unknown';
  }

  const body: Record<string, unknown> = {
    status: dbOk ? 'ok' : 'unhealthy',
    db: dbOk ? 'ok' : 'error',
    checkMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };
  if (dbError) body.dbError = dbError;

  if (deep && dbOk) {
    try {
      const b = await readLastBackup();
      const lastRunAt = b.lastRunAt ? new Date(b.lastRunAt) : null;
      body.backup = {
        lastRunAt: b.lastRunAt,
        ageHours: lastRunAt ? Math.round((Date.now() - lastRunAt.getTime()) / 3600_000) : null,
        lastError: b.lastError ?? null,
      };
    } catch {
      // deep signals are best-effort; never fail the probe on them
    }
  }

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
