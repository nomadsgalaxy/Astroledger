import { cookies } from 'next/headers';
import { RANGE_COOKIE, isRangeKey, rangeMeta, DEFAULT_RANGE, type RangeKey } from './timeRange';

/** Server-side: read cookie + compute since/until. */
export async function getRange() {
  const c = await cookies();
  const raw = c.get(RANGE_COOKIE)?.value;
  const key: RangeKey = isRangeKey(raw) ? raw : DEFAULT_RANGE;
  const meta = rangeMeta(key);
  const until = new Date();
  const since = new Date(+until - meta.days * 86400000);
  return { key, label: meta.label, shortLabel: meta.shortLabel, days: meta.days, since, until };
}
