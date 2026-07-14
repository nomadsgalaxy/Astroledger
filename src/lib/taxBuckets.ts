import { prisma } from './prisma';

// Default Schedule C buckets seeded on first use. Matchers are deliberately
// empty - the user fills them in via the UI. Pre-populating them surfaces
// the IRS schema without polluting the tag namespace.
export const DEFAULT_BUCKETS: Array<{ scheduleLine: string; name: string; sortOrder: number }> = [
  { scheduleLine: 'Line 8',  name: 'Advertising',                       sortOrder: 1 },
  { scheduleLine: 'Line 9',  name: 'Car and truck expenses',            sortOrder: 2 },
  { scheduleLine: 'Line 10', name: 'Commissions and fees',              sortOrder: 3 },
  { scheduleLine: 'Line 11', name: 'Contract labor',                    sortOrder: 4 },
  { scheduleLine: 'Line 13', name: 'Depreciation',                      sortOrder: 5 },
  { scheduleLine: 'Line 15', name: 'Insurance (other than health)',     sortOrder: 6 },
  { scheduleLine: 'Line 16', name: 'Interest',                          sortOrder: 7 },
  { scheduleLine: 'Line 17', name: 'Legal and professional services',   sortOrder: 8 },
  { scheduleLine: 'Line 18', name: 'Office expense',                    sortOrder: 9 },
  { scheduleLine: 'Line 20a', name: 'Rent - vehicles, machinery, equipment', sortOrder: 10 },
  { scheduleLine: 'Line 20b', name: 'Rent - other business property',   sortOrder: 11 },
  { scheduleLine: 'Line 21', name: 'Repairs and maintenance',           sortOrder: 12 },
  { scheduleLine: 'Line 22', name: 'Supplies',                          sortOrder: 13 },
  { scheduleLine: 'Line 23', name: 'Taxes and licenses',                sortOrder: 14 },
  { scheduleLine: 'Line 24a', name: 'Travel',                           sortOrder: 15 },
  { scheduleLine: 'Line 24b', name: 'Meals (50%)',                      sortOrder: 16 },
  { scheduleLine: 'Line 25', name: 'Utilities',                         sortOrder: 17 },
  { scheduleLine: 'Line 27a', name: 'Other expenses',                   sortOrder: 18 },
];

export async function ensureDefaultBuckets() {
  const c = await prisma.taxBucket.count();
  if (c > 0) return;
  await prisma.taxBucket.createMany({
    data: DEFAULT_BUCKETS.map(b => ({ ...b, matchers: '[]' })),
  });
}

export type Matcher = { kind: 'tag' | 'category'; value: string };

export function parseMatchers(s: string): Matcher[] {
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.filter((m: any) => m && (m.kind === 'tag' || m.kind === 'category') && typeof m.value === 'string');
  } catch { return []; }
}
