// CLI runner — invoked manually by the user (or by an API endpoint that the
// user explicitly triggers).
//   npx tsx playwright/runner.ts amazon
//
// Reads creds from ASTROLEDGER_PLAYWRIGHT_CREDS (JSON) so they never hit disk
// outside Astroledger's encrypted store.

import { chromium } from 'playwright';
import { ADAPTERS } from './adapters';

async function main() {
  const adapterId = process.argv[2];
  if (!adapterId || !ADAPTERS[adapterId]) {
    console.error('Usage: tsx playwright/runner.ts <adapterId>');
    console.error('Available:', Object.keys(ADAPTERS).join(', '));
    process.exit(1);
  }
  const adapter = ADAPTERS[adapterId];
  const credsJson = process.env.ASTROLEDGER_PLAYWRIGHT_CREDS;
  if (!credsJson) { console.error('ASTROLEDGER_PLAYWRIGHT_CREDS env required'); process.exit(1); }
  const creds = JSON.parse(credsJson);
  const sinceDays = parseInt(process.env.ASTROLEDGER_PLAYWRIGHT_SINCE_DAYS ?? '90');

  console.error(`[playwright] running ${adapter.id}, since ${sinceDays}d`);
  const browser = await chromium.launch({ headless: false });
  try {
    const orders = await adapter.run({ browser, creds, sinceDays });
    console.log(JSON.stringify(orders));      // stdout = result, parseable by parent
    console.error(`[playwright] captured ${orders.length} orders`);
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
