// Run before `npm run build` in production. Fails loudly if required env vars are missing.
import 'dotenv/config';

const REQUIRED = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

const RECOMMENDED = [
  'ALLOWED_EMAILS',
  'NEXTAUTH_URL',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_ORIGIN',
];

const missing: string[] = [];
const warn: string[] = [];

for (const k of REQUIRED) if (!process.env[k]) missing.push(k);
for (const k of RECOMMENDED) if (!process.env[k]) warn.push(k);

if (missing.length) {
  console.error('\n❌ Missing REQUIRED env vars:');
  for (const k of missing) console.error(`   - ${k}`);
  console.error('\nSee .env.example for instructions on each variable.\n');
  process.exit(1);
}

if (warn.length) {
  console.warn('\n⚠️  Missing RECOMMENDED env vars (app will work but with degraded security/features):');
  for (const k of warn) console.warn(`   - ${k}`);
  console.warn('');
}

if (process.env.NODE_ENV === 'production' && !process.env.MASTER_KEY && !process.env.ASTROLEDGER_MASTER_KEY_FILE) {
  console.error('\n❌ ASTROLEDGER_MASTER_KEY_FILE (preferred) or MASTER_KEY is REQUIRED in production.\n');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && process.env.ASTROLEDGER_DB_ENCRYPTED !== 'true') {
  console.error('\n❌ ASTROLEDGER_DB_ENCRYPTED=true is REQUIRED in production.\n');
  process.exit(1);
}

console.log('✓ Environment validated.');
