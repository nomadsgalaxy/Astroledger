import { NextRequest, NextResponse } from 'next/server';
import { connectSimpleFin, SimpleFinClaimError } from '@/lib/simplefin';
import { detectSubscriptions } from '@/lib/detectSubscriptions';
import { buildRecommendations } from '@/lib/recommend';
import { requireSessionAndVault } from '@/lib/guards';
import { VaultLockedError } from '@/lib/vault';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // CRITICAL: verify session + vault BEFORE claiming the setup token. The
  // token is one-time-use; if we hit SimpleFIN first and only then discover
  // the vault is locked, the user has to get a new token from the bridge.
  const guard = await requireSessionAndVault();
  if (guard instanceof NextResponse) return guard;
  try {
    const { setupToken, name, reconnectInstitutionId } = await req.json();
    if (!setupToken) return NextResponse.json({ error: 'setupToken required' }, { status: 400 });
    const out = await connectSimpleFin(setupToken, name, reconnectInstitutionId);
    await detectSubscriptions();
    await buildRecommendations();
    return NextResponse.json(out);
  } catch (e: any) {
    // Pass through structured error info so the UI can show the right hint.
    if (e instanceof SimpleFinClaimError) {
      return NextResponse.json({ error: e.message, code: e.reason, source: 'simplefin' }, { status: e.status });
    }
    if (e instanceof VaultLockedError) {
      return NextResponse.json({ error: e.message, code: 'VAULT_LOCKED' }, { status: 503 });
    }
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
