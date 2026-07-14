// Backup controller.
//   GET  → returns config + last-run + list of backup files
//   POST → { runNow: true } to backup immediately, OR config patch to update settings

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { readBackupConfig, writeBackupConfig, runBackup, listBackups, readLastBackup, initBackupSchedulerOnce, restoreBackup, verifyBackupFile } from '@/lib/backup';

export const runtime = 'nodejs';
export const maxDuration = 300;

// NOTE: the `password` field on POST bodies here is a backup-encryption secret.
// It must NEVER be logged, echoed in a response, or persisted. Exclude this
// route from any verbose request-body logging middleware.

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  await initBackupSchedulerOnce();
  const [config, last, list] = await Promise.all([readBackupConfig(), readLastBackup(), listBackups()]);
  return NextResponse.json({ config, ...last, backups: list });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // Our typed backup-crypto errors carry fixed, safe messages (no secrets).
  // Any OTHER error is treated as internal: log server-side, return a generic
  // message so raw exception text / stack / paths never reach the client.
  const SAFE_CODES = new Set(['WEAK_PASSWORD', 'BAD_PASSWORD', 'MALFORMED', 'BAD_VERSION']);
  function internalError(e: any) {
    console.error('[backup] internal error:', e?.message ?? e);
    return NextResponse.json({ error: 'An internal error occurred. Check server logs.' }, { status: 500 });
  }

  if (body.runNow) {
    try {
      const stats = await runBackup({ password: typeof body.password === 'string' ? body.password : undefined });
      return NextResponse.json({ ok: true, stats });
    } catch (e: any) {
      if (e?.code === 'WEAK_PASSWORD') return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
      return internalError(e);
    }
  }

  if (typeof body.restore === 'string') {
    try {
      const result = await restoreBackup(body.restore, typeof body.password === 'string' ? body.password : undefined);
      return NextResponse.json({ ok: true, result });
    } catch (e: any) {
      if (e?.code === 'PASSWORD_REQUIRED') return NextResponse.json({ needsPassword: true }, { status: 422 });
      if (SAFE_CODES.has(e?.code))         return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
      return internalError(e);
    }
  }

  if (typeof body.verifyBackup === 'string') {
    try {
      const verify = await verifyBackupFile(body.verifyBackup, typeof body.password === 'string' ? body.password : undefined);
      return NextResponse.json({ ok: true, verify });
    } catch (e: any) {
      if (e?.code === 'PASSWORD_REQUIRED') return NextResponse.json({ needsPassword: true }, { status: 422 });
      if (SAFE_CODES.has(e?.code))         return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
      return internalError(e);
    }
  }

  const config = await writeBackupConfig({
    enabled:       typeof body.enabled === 'boolean' ? body.enabled : undefined,
    intervalHours: body.intervalHours !== undefined ? Math.max(0.5, Math.min(720, parseFloat(body.intervalHours))) : undefined,
    retentionDays: body.retentionDays !== undefined ? Math.max(1, Math.min(3650, parseInt(body.retentionDays))) : undefined,
    destDir:       body.destDir !== undefined ? String(body.destDir) : undefined,
  });
  await initBackupSchedulerOnce();
  return NextResponse.json({ config });
}
