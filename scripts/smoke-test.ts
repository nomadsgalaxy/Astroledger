// Quick smoke test — hits a handful of endpoints to verify the server is responding.
// Run AFTER `npm run dev` is running: `npx tsx scripts/smoke-test.ts`

const BASE = process.env.SMOKE_BASE || 'http://localhost:5050';

async function check(path: string, expectStatus = [200, 302, 307, 401]) {
  try {
    const res = await fetch(BASE + path, { redirect: 'manual' });
    const ok = expectStatus.includes(res.status);
    console.log(`${ok ? '✓' : '✗'} ${path.padEnd(36)} ${res.status}`);
    return ok;
  } catch (e: any) {
    console.log(`✗ ${path.padEnd(36)} ERROR: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`Smoke-testing ${BASE}\n`);
  const results = await Promise.all([
    check('/', [200, 302, 307]),
    check('/auth/signin', [200]),
    check('/api/auth/providers', [200]),
    check('/api/auth/session', [200]),
    check('/cashflow', [200, 302, 307]),
    check('/budgets', [200, 302, 307]),
    check('/transactions', [200, 302, 307]),
    check('/accounts', [200, 302, 307]),
    check('/subscriptions', [200, 302, 307]),
    check('/orders', [200, 302, 307]),
    check('/goals', [200, 302, 307]),
    check('/networth', [200, 302, 307]),
    check('/reports', [200, 302, 307]),
    check('/merchants', [200, 302, 307]),
    check('/alerts', [200, 302, 307]),
    check('/insights', [200, 302, 307]),
    check('/connect', [200, 302, 307]),
    check('/settings', [200, 302, 307]),
  ]);
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} / ${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
