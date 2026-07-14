// CLI wrapper around detectSubscriptions. Used by:
//   - Demo seeder (re-detect subs after seed:demo --reset)
//   - Hourly demo-reset scheduled task
//   - Ad-hoc operator runs after a bulk import
//
// Writes results directly to the DB; no flags needed.
//
// Usage: npm run detect

import { detectSubscriptions } from '../src/lib/detectSubscriptions';

(async () => {
  const result = await detectSubscriptions({ writeRecommendations: true });
  console.log(`detected ${result.created ?? 0} new subscriptions, ${result.updated ?? 0} updated`);
  process.exit(0);
})().catch(err => {
  console.error('detection failed:', err);
  process.exit(1);
});
