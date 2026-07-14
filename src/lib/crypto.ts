// AES-256-GCM field encryption with versioned ciphertext envelopes.
// Format: "v1:" + base64(iv|tag|ciphertext)
//
// Key sourcing: this module reads vault state DIRECTLY from globalThis rather
// than via vault.ts's exported helpers. Reason: the Prisma client singleton
// (created once at boot, cached on globalThis) closes over THIS module's
// encrypt/decrypt functions. If vault.ts is HMR-reloaded later, the OLD
// vault.ts module - with its OLD module-scope `unlockedKey` variable - is
// what THIS module's encrypt function would still consult, even though the
// new vault.ts mutates a different variable. Reading directly from globalThis
// dodges that closure-trap so encrypt always sees the latest unlocked key.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { VaultLockedError, newMasterKeyHex } from './vault';

const VERSION = 'v1';

type VaultState = { key: Buffer | null; at: number | null };
function readVaultKey(): Buffer | null {
  const g = globalThis as unknown as { __astroledgerVault?: VaultState };
  return g.__astroledgerVault?.key ?? null;
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  const key = readVaultKey();
  if (!key) throw new VaultLockedError('Cannot encrypt: vault is locked.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

export function decrypt(envelope: string | null | undefined): string | null {
  if (envelope == null || envelope === '') return null;
  if (!envelope.startsWith(`${VERSION}:`)) {
    // Legacy unencrypted column value from before this feature existed.
    return envelope;
  }
  const key = readVaultKey();
  if (!key) {
    // Fail-closed: return null instead of throwing so reads don't crash
    // ordinary pages. The decrypted field will be missing/empty.
    return null;
  }
  try {
    const buf = Buffer.from(envelope.slice(VERSION.length + 1), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Binary envelope for uploaded documents. Keeping file encryption separate
// from the string-column format makes accidental text decoding impossible and
// gives us an unambiguous magic value for legacy/plaintext migration.
const FILE_MAGIC = Buffer.from('ALFILE01', 'ascii');

export function isEncryptedBuffer(value: Buffer): boolean {
  return value.length >= FILE_MAGIC.length && value.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = readVaultKey();
  if (!key) throw new VaultLockedError('Cannot encrypt file: vault is locked.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(FILE_MAGIC);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(envelope: Buffer): Buffer {
  if (!isEncryptedBuffer(envelope)) return envelope; // legacy upload
  if (envelope.length < FILE_MAGIC.length + 12 + 16) throw new Error('Malformed encrypted receipt.');
  const key = readVaultKey();
  if (!key) throw new VaultLockedError('Cannot decrypt file: vault is locked.');
  const ivStart = FILE_MAGIC.length;
  const tagStart = ivStart + 12;
  const ctStart = tagStart + 16;
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(ivStart, tagStart));
  decipher.setAAD(FILE_MAGIC);
  decipher.setAuthTag(envelope.subarray(tagStart, ctStart));
  return Buffer.concat([decipher.update(envelope.subarray(ctStart)), decipher.final()]);
}

export { newMasterKeyHex };
