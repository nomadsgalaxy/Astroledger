import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';

export function readSecret(fileEnv: string, valueEnv: string): string | null {
  const file = process.env[fileEnv]?.trim();
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[valueEnv]?.trim();
  return value || null;
}

export function databaseKey(): Buffer {
  const source = readSecret('ASTROLEDGER_DB_KEY_FILE', 'SQLCIPHER_KEY');
  if (!source) {
    throw new Error('ASTROLEDGER_DB_KEY_FILE (preferred) or SQLCIPHER_KEY is required.');
  }
  return /^[0-9a-fA-F]{64}$/.test(source)
    ? Buffer.from(source, 'hex')
    : scryptSync(source, 'astroledger-db-key-v1', 32);
}

export function backupPassword(): string | null {
  return readSecret('ASTROLEDGER_BACKUP_KEY_FILE', 'ASTROLEDGER_BACKUP_KEY');
}
