import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndVault } from '@/lib/guards';
import { runInstitutionSync } from '@/lib/syncRunner';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Unified institution refresh. Routes by source so callers don't need to know
 * which connector is behind each institution. Records per-institution health
 * (last synced / status / error) via the shared runner.
 *
 * Body:
 *   institutionId?: string  // omit to refresh ALL institutions
 *   sinceDays?:     number  // lookback window in days; default 365
 *
 * Returns:
 *   { results: [{institution, institutionId, source, added, updated, skipped, error?}, ...],
 *     totals: { added, updated, attempted, failed } }
 */
export async function POST(req: NextRequest) {
  // Reading Institution.accessToken requires an unlocked vault; the guard
  // unlocks it (idempotent) and verifies the session before any connector call.
  const guard = await requireSessionAndVault();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({})) as { institutionId?: string; sinceDays?: number };
  const out = await runInstitutionSync({ institutionId: body.institutionId, sinceDays: body.sinceDays });
  return NextResponse.json(out);
}
