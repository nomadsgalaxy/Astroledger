import { promises as fs } from 'node:fs';
import path from 'node:path';
import { decryptBuffer, encryptBuffer } from './crypto';

export function receiptStorageRoot(): string {
  return path.resolve(process.env.ASTROLEDGER_UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'));
}

export function resolveReceiptPath(relativePath: string): string {
  const root = receiptStorageRoot();
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Receipt path escapes the configured upload directory.');
  }
  return full;
}

export async function writeEncryptedReceipt(relativePath: string, plaintext: Buffer): Promise<void> {
  const full = resolveReceiptPath(relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, encryptBuffer(plaintext), { mode: 0o600 });
}

export async function readDecryptedReceipt(relativePath: string): Promise<Buffer> {
  return decryptBuffer(await fs.readFile(resolveReceiptPath(relativePath)));
}

// Generic aliases used by the financial document vault. Both receipts and
// documents share the authenticated ALFILE01 encrypted file envelope.
export const writeEncryptedUpload = writeEncryptedReceipt;
export const readDecryptedUpload = readDecryptedReceipt;

export async function deleteEncryptedUpload(relativePath: string): Promise<void> {
  await fs.unlink(resolveReceiptPath(relativePath)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}
