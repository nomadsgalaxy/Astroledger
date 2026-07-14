// Verify a fresh Astroledger install is ready to boot.
//
// Run after `cp .env.example .env` and filling in the required fields:
//   npm run setup:check
//
// Exits non-zero on hard failures (so it's CI-friendly). Prints a colored
// punch-list of what passed and what's missing.
import 'dotenv/config';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let hardFails = 0;
let softWarns = 0;

function pass(label: string, detail = '') {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}
function fail(label: string, fix: string) {
  console.log(`  ${RED}✗${RESET} ${label}\n      ${DIM}→ ${fix}${RESET}`);
  hardFails++;
}
function warn(label: string, fix: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${label}\n      ${DIM}→ ${fix}${RESET}`);
  softWarns++;
}

console.log(`\n${DIM}Astroledger setup check${RESET}\n`);

// ─── 1. Node version ───────────────────────────────────────────────────────
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor >= 20) pass('Node.js version', `${process.versions.node}`);
else fail(`Node.js ${process.versions.node} — too old`, 'Install Node 20+ (24+ recommended). https://nodejs.org');

// ─── 2. .env exists ────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) pass('.env present');
else {
  fail('.env not found', 'Run: cp .env.example .env (or copy .env.example .env on Windows), then edit it.');
}

// ─── 3. Required env vars ──────────────────────────────────────────────────
type Var = { name: string; required: boolean; fix: string; check?: (v: string) => string | null };
const VARS: Var[] = [
  { name: 'DATABASE_URL', required: true,
    fix: 'Default: file:./dev.db. See section 1 of .env.example.' },
  { name: 'AUTH_SECRET', required: true,
    fix: 'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' },
  { name: 'GOOGLE_CLIENT_ID', required: true,
    fix: 'Create OAuth Web client at https://console.cloud.google.com/apis/credentials' },
  { name: 'GOOGLE_CLIENT_SECRET', required: true,
    fix: 'Paste from the same Google OAuth client you created the ID with.' },
  { name: 'MASTER_KEY', required: false,
    fix: 'Generate: npx tsx scripts/new-master-key.ts. Required in production (NODE_ENV=production).',
    check: (v) => v.length < 32 ? 'looks short; should be 64 hex chars or a long passphrase' : null },
  { name: 'AUTH_URL', required: false,
    fix: 'Set to your public origin (e.g. http://localhost:5050 for dev, https://astroledger.example.com for prod).',
  },
];

console.log('');
console.log(`${DIM}Environment variables${RESET}`);
for (const v of VARS) {
  const value = process.env[v.name];
  if (!value) {
    if (v.required) fail(`${v.name} missing`, v.fix);
    else warn(`${v.name} unset`, v.fix);
    continue;
  }
  if (v.check) {
    const issue = v.check(value);
    if (issue) { warn(`${v.name} ${issue}`, v.fix); continue; }
  }
  pass(v.name, '✓');
}

// Special checks for the fail-closed production encryption configuration.
if (process.env.NODE_ENV === 'production' && !process.env.MASTER_KEY && !process.env.ASTROLEDGER_MASTER_KEY_FILE) {
  fail('NODE_ENV=production but no field-encryption key is configured',
       'Set ASTROLEDGER_MASTER_KEY_FILE (preferred) or MASTER_KEY.');
}
if (process.env.NODE_ENV === 'production' && process.env.ASTROLEDGER_DB_ENCRYPTED !== 'true') {
  fail('NODE_ENV=production but full database encryption is disabled',
       'Set ASTROLEDGER_DB_ENCRYPTED=true and configure ASTROLEDGER_DB_KEY_FILE.');
}

// ─── 4. Prisma client + DB schema applied ──────────────────────────────────
console.log('');
console.log(`${DIM}Database${RESET}`);
const prismaClientPath = resolve(process.cwd(), 'node_modules', '.prisma', 'client');
if (existsSync(prismaClientPath)) {
  pass('Prisma client generated', '.prisma/client present');
} else {
  fail('Prisma client missing',
       'Run: npx prisma db push  (creates the SQLite DB + generates the client)');
}

// Best-effort DB file check (only meaningful for SQLite). Prisma resolves
// relative `file:...` paths against schema.prisma's location, NOT cwd —
// so for the default `file:./dev.db`, the real file is at prisma/dev.db.
const dbUrl = process.env.DATABASE_URL ?? '';
const fileMatch = dbUrl.match(/^file:(.+)$/);
if (fileMatch) {
  const rawPath = fileMatch[1];
  const candidates = rawPath.startsWith('/')
    ? [rawPath]   // absolute path — only one place to look
    : [
        resolve(process.cwd(), 'prisma', rawPath),  // Prisma's actual resolution
        resolve(process.cwd(), rawPath),            // cwd fallback
      ];
  const found = candidates.find(p => existsSync(p));
  if (found) {
    const size = statSync(found).size;
    pass('SQLite DB file present', `${found} (${(size/1024).toFixed(1)} KB)`);
  } else {
    fail(`SQLite DB file missing (looked in ${candidates.join(' and ')})`,
         'Run: npx prisma db push');
  }
}

// ─── 5. Optional: local LLM ────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log(`${DIM}Optional integrations${RESET}`);
  const ollamaUrl = process.env.OLLAMA_BASE_URL;
  if (ollamaUrl) {
    try {
      const probe = await fetch(ollamaUrl.replace(/\/v1\/?$/, '') + '/api/tags', {
        signal: AbortSignal.timeout(2_000),
      });
      if (probe.ok) pass('Local LLM reachable', ollamaUrl);
      else warn(`LLM at ${ollamaUrl} returned ${probe.status}`,
                `Make sure Ollama is running. With AUTO_START_LLM=true, Astroledger will start it on first chat.`);
    } catch {
      warn(`LLM not reachable at ${ollamaUrl}`,
           `Ollama may not be running. With AUTO_START_LLM=true, Astroledger starts it on first chat. Otherwise: npm run llm:up`);
    }
  } else {
    warn('OLLAMA_BASE_URL unset', 'Chat + Gmail auto-classify will degrade. Set to http://localhost:11434/v1 or a remote endpoint.');
  }

  // Plaid + Google integration hints (informational).
  const plaid = process.env.PLAID_CLIENT_ID;
  if (plaid) pass('Plaid configured', `env=${process.env.PLAID_ENV ?? '(unset)'}`);
  else console.log(`  ${DIM}- Plaid not configured (optional). Self-hosters often start with SimpleFIN or CSV.${RESET}`);

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  if (hardFails === 0 && softWarns === 0) {
    console.log(`${GREEN}✓ Setup looks good. Start the dev server: npm run dev${RESET}\n`);
    process.exit(0);
  }
  if (hardFails === 0) {
    console.log(`${YELLOW}Setup is workable with ${softWarns} warning${softWarns === 1 ? '' : 's'}.${RESET}`);
    console.log(`${YELLOW}You can still start the dev server, but some integrations will degrade.${RESET}\n`);
    process.exit(0);
  }
  console.log(`${RED}Setup has ${hardFails} hard failure${hardFails === 1 ? '' : 's'} and ${softWarns} warning${softWarns === 1 ? '' : 's'}.${RESET}`);
  console.log(`${RED}Fix the items marked ✗ above, then re-run: npm run setup:check${RESET}\n`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(2); });
