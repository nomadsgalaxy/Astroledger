// Scheduled connector sync. Authenticated via CRON_SECRET in the Authorization
// header so an external scheduler (Windows Task Scheduler, systemd timer, cron,
// GitHub Actions) can pull fresh transactions on a cadence without a logged-in
// browser session:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:5050/api/cron/sync
//
// UNLIKE /api/cron/monthly (which only refreshes derived data and deliberately
// leaves the vault locked), this endpoint MUST decrypt connector credentials,
// so it unlocks the vault from MASTER_KEY up front. unlockVault() reads
// MASTER_KEY directly from the environment — no user session required. If
// MASTER_KEY is unset the unlock throws and we return 503 without burning any
// connector quota.
//
// Body (optional JSON): { institutionId?: string, sinceDays?: number }
//   institutionId  — sync just one institution (default: all live ones)
//   sinceDays      — lookback window (default 365, clamped 1..1095)

import { NextRequest, NextResponse } from 'next/server';
import { unlockVault, isVaultUnlocked } from '@/lib/vault';
import { runInstitutionSync } from '@/lib/syncRunner';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  return token === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Unlock the vault from MASTER_KEY (no session in a cron context). Without
  // this, reads of Institution.accessToken return null and every sync would be
  // (mis)recorded as a credential failure.
  if (!isVaultUnlocked()) {
    try {
      unlockVault();
    } catch (e: any) {
      return NextResponse.json({
        error: `Vault is locked: ${e?.message ?? String(e)}. Set MASTER_KEY in the server's environment to enable scheduled sync.`,
        code: 'VAULT_LOCKED',
      }, { status: 503 });
    }
  }

  const body = await req.json().catch(() => ({})) as { institutionId?: string; sinceDays?: number };
  const start = Date.now();

  // Skip the runner's post-pass; we run detection + recs once below regardless
  // of how many institutions synced.
  const out = await runInstitutionSync({
    institutionId: body.institutionId,
    sinceDays: body.sinceDays,
    skipPostPass: true,
  });

  try { await detectSubscriptions(); } catch {}
  try { await buildRecommendations(); } catch {}

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - start,
    ...out,
  });
}
