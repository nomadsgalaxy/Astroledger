export const RANGE_COOKIE = 'astroledger_range';

export type RangeKey = '7d' | '30d' | '90d' | '6mo' | '12mo';

export const RANGE_OPTIONS: { key: RangeKey; label: string; shortLabel: string; days: number }[] = [
  { key: '7d',   label: 'Last 7 days',   shortLabel: '7D',  days: 7 },
  { key: '30d',  label: 'Last 30 days',  shortLabel: '30D', days: 30 },
  { key: '90d',  label: 'Last 90 days',  shortLabel: '90D', days: 90 },
  { key: '6mo',  label: 'Last 6 months', shortLabel: '6M',  days: 180 },
  { key: '12mo', label: 'Last 12 months', shortLabel: '12M', days: 365 },
];

export const DEFAULT_RANGE: RangeKey = '30d';

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === 'string' && RANGE_OPTIONS.some(o => o.key === v);
}

export function rangeMeta(key: RangeKey) {
  return RANGE_OPTIONS.find(o => o.key === key) ?? RANGE_OPTIONS[1];
}
