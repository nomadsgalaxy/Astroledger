// Vault - in-memory holder for the data encryption key (DEK).
//
// Threat model this addresses:
//   • Prevents accidental data exposure if an API route forgets to check auth - 
//     the Prisma client extension calls into the vault to decrypt; if no one's
//     signed in since boot, decryption returns null and the route serves stub
//     data instead of leaking real records.
//   • Preserves "no plaintext at rest while no user is active" for short-lived
//     attacker access after a server restart.
//
// What it does NOT address:
//   • An attacker with the server's env vars and disk can still derive the DEK
//     from MASTER_KEY (this would require a user passphrase prompt to fix).
//   • Once a user signs in, the DEK stays in process memory for the lifetime
//     of the process.

import { scryptSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Hoist the unlocked-key state onto globalThis so it survives:
//   - Next.js dev HMR reloads (this module gets re-evaluated, but globalThis
//     persists for the lifetime of the Node process)
//   - Webpack chunk splits where the same module ends up bundled twice (the
//     API-route bundle and the prisma-extension bundle each held their own
//     `unlockedKey` - that's why the guard could unlock the vault and the
//     prisma encrypt hook would still see it locked)
type VaultState = { key: Buffer | null; at: number | null };
const g = globalThis as unknown as { __astroledgerVault?: VaultState };
if (!g.__astroledgerVault) g.__astroledgerVault = { key: null, at: null };
const state = g.__astroledgerVault;

export class VaultLockedError extends Error {
  constructor(message = 'Vault is locked - sign in to access encrypted data.') {
    super(message);
    this.name = 'VaultLockedError';
  }
}

/**
 * Unlock the vault using the configured MASTER_KEY. Idempotent.
 * In production, MASTER_KEY MUST be set. In dev a deterministic fallback is used
 * so devs aren't blocked, but a console warning fires.
 */
export function unlockVault(): void {
  if (state.key) return;
  const keyFile = process.env.ASTROLEDGER_MASTER_KEY_FILE;
  const source = keyFile
    ? readFileSync(keyFile, 'utf8').trim()
    : process.env.MASTER_KEY?.trim();
  if (!source) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ASTROLEDGER_MASTER_KEY_FILE or MASTER_KEY must be set in production to unlock the vault.');
    }
    console.warn('[vault] No MASTER_KEY set - using insecure dev fallback. Do NOT store real data.');
    state.key = scryptSync('astroledger-dev-only', 'astroledger-salt', 32);
  } else if (/^[0-9a-fA-F]{64}$/.test(source)) {
    state.key = Buffer.from(source, 'hex');
  } else {
    state.key = scryptSync(source, 'astroledger-app-salt', 32);
  }
  state.at = Date.now();
}

export function lockVault(): void {
  if (state.key) {
    state.key.fill(0);
    state.key = null;
    state.at = null;
  }
}

export function isVaultUnlocked(): boolean {
  return state.key !== null;
}

export function vaultUnlockedAt(): number | null {
  return state.at;
}

/** Returns the active DEK. Throws if the vault is locked. */
export function getVaultKey(): Buffer {
  if (!state.key) throw new VaultLockedError();
  return state.key;
}

/** Generate a fresh hex MASTER_KEY for setup. */
export function newMasterKeyHex(): string {
  return randomBytes(32).toString('hex');
}
