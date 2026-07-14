// Route-handler guards. Centralizes the pattern of "verify the user is signed
// in AND the encryption vault is unlocked" so callers don't accidentally
// trigger an irreversible external side effect (claiming a one-time-use
// token, charging an API quota, etc.) before discovering the local store
// can't accept the result.
//
// Why this exists:
//   The /api/simplefin/connect route used to do its auth via the edge
//   middleware (cookie sniff only). That meant the route handler never
//   actually called auth(), which is what triggers the session() callback,
//   which is what calls unlockVault(). So after a server restart the route
//   would call SimpleFIN, BURN the user's setup token, then try to encrypt
//   the access URL, hit a locked vault, throw - and the user couldn't retry
//   because the token was already consumed.

import { NextResponse } from 'next/server';
import { auth } from './auth';
import { isVaultUnlocked, unlockVault } from './vault';

export type GuardFailure = NextResponse;
export type GuardPass = { userId: string; userEmail: string };

/**
 * Combined session + vault preflight. Returns a NextResponse (error) on
 * failure, or a { userId, userEmail } object on success. Always call this
 * at the TOP of any route that will touch encrypted columns OR make an
 * irreversible external call whose result needs to be persisted.
 *
 * Order matters: unlock the vault FIRST, then check the session. Next.js
 * dev HMR resets the in-memory vault state between recompiles; if we waited
 * on auth() to re-unlock via the session callback, a route that read the
 * session before the callback ran could see a locked vault. Unlocking up
 * front is harmless when MASTER_KEY is set (it's just a hash derivation).
 *
 * Usage:
 *   const guard = await requireSessionAndVault();
 *   if (guard instanceof NextResponse) return guard;
 *   const { userId } = guard;
 *   // ...safe to claim tokens, encrypt access URLs, etc.
 */
export async function requireSessionAndVault(): Promise<GuardPass | GuardFailure> {
  // 1. Unlock the vault up front. In prod without MASTER_KEY this throws;
  //    we surface that as a 503 with a clear remediation message.
  if (!isVaultUnlocked()) {
    try { unlockVault(); } catch (e: any) {
      return NextResponse.json({
        error: `Vault is locked: ${e?.message ?? String(e)}. Set MASTER_KEY in the server's environment.`,
        code: 'VAULT_LOCKED',
      }, { status: 503 });
    }
  }
  // 2. Now check session. auth() will also trigger the session callback,
  //    which is idempotent w.r.t. the vault (already unlocked).
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'NO_SESSION' }, { status: 401 });
  }
  // 3. Final paranoid check - if for any reason the vault is STILL locked
  //    (shouldn't be reachable), bail before any irreversible side effects.
  if (!isVaultUnlocked()) {
    return NextResponse.json({
      error: 'Vault is locked. Sign out and back in to unlock before connecting an institution. Your setup token has NOT been consumed.',
      code: 'VAULT_LOCKED',
    }, { status: 503 });
  }
  return {
    userId: (session.user as any).id as string,
    userEmail: session.user.email!,
  };
}
