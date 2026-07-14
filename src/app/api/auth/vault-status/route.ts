import { NextResponse } from 'next/server';
import { requireSessionAndVault } from '@/lib/guards';
import { isVaultUnlocked } from '@/lib/vault';
import { encrypt, decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET /api/auth/vault-status - pre-flight check + optional deep probe.
// Returns:
//   200 { unlocked: true }            - safe to proceed
//   401 { error, code: 'NO_SESSION' } - not signed in
//   503 { error, code: 'VAULT_LOCKED' } - signed in but vault still locked
//
// Send ?probe=1 to also exercise the encrypt + decrypt + prisma round-trip
// path that SimpleFIN/Plaid hit - surfaces chunk-split bugs (where the route's
// vault module is unlocked but prisma extension's vault module is locked).
export async function GET(req: Request) {
  const guard = await requireSessionAndVault();
  if (guard instanceof NextResponse) return guard;

  const probe = new URL(req.url).searchParams.get('probe') === '1';
  if (!probe) return NextResponse.json({ unlocked: true });

  const out: any = {
    unlocked: true,
    vault_module_isUnlocked: isVaultUnlocked(),
    crypto_module_encrypt: 'untested',
    prisma_extension_encrypt: 'untested',
  };
  // 1. Direct crypto.ts encrypt - would fail if the crypto module sees a
  //    different vault state from the guard.
  try {
    const sample = 'astroledger-vault-probe-' + Date.now();
    const enc = encrypt(sample);
    const dec = enc ? decrypt(enc) : null;
    out.crypto_module_encrypt = (dec === sample) ? 'ok' : `mismatch: ${dec}`;
  } catch (e: any) {
    out.crypto_module_encrypt = `error: ${e?.message ?? e}`;
  }
  // 2. Round-trip through Prisma extension - write to a throwaway AppSetting
  //    row (AppSetting is unencrypted but Institution.accessToken is). We use
  //    Institution directly via a transactional create+rollback so we don't
  //    pollute the table.
  try {
    await prisma.$transaction(async (tx) => {
      const inst = await tx.institution.create({
        data: { name: '__astroledger_vault_probe__', source: 'probe', accessToken: 'probe-value-' + Date.now() },
        select: { id: true, accessToken: true },
      });
      out.prisma_extension_encrypt = (inst.accessToken && !inst.accessToken.startsWith('v1:'))
        ? 'ok (decrypt-on-read worked)'
        : `bad: ${inst.accessToken}`;
      // Roll back so the probe row doesn't survive
      throw new Error('__rollback__');
    }).catch(e => { if (e.message !== '__rollback__') throw e; });
  } catch (e: any) {
    out.prisma_extension_encrypt = `error: ${e?.message ?? e}`;
  }
  return NextResponse.json(out);
}
