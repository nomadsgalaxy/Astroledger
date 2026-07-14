// Generates one fresh MASTER_KEY suitable for AES-256-GCM field encryption,
// and prints copy-paste-ready instructions.
//
// Usage: npx tsx scripts/new-master-key.ts
import { newMasterKeyHex } from '../src/lib/crypto';

const key = newMasterKeyHex();

console.log('');
console.log('Generated a fresh MASTER_KEY for field-level encryption.');
console.log('');
console.log('Add this exact line to your .env (replacing any existing MASTER_KEY=):');
console.log('');
console.log('  MASTER_KEY=' + key);
console.log('');
console.log('⚠  Keep this key secret. If it leaks, the encrypted columns in');
console.log('   your database can be decrypted. If you lose it, you cannot');
console.log('   recover those columns (Plaid/SimpleFIN tokens, raw Order bodies).');
console.log('');
