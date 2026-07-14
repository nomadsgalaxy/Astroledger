import { NextResponse } from 'next/server';
import { prisma, getRequestFinancialAccess } from '@/lib/prisma';
import { ensureDefaultBuckets, parseMatchers } from '@/lib/taxBuckets';
import { auth } from '@/lib/auth';

// Group all outflows in [year-01-01, year-12-31] by the configured tax
// buckets and stream a CSV grouped by Schedule C line.
//
// Match priority: tag match (any of the tx's tags matches a bucket matcher's
// `value` by name) > category match. A tx that matches multiple buckets is
// charged to the first one in sortOrder (deterministic; user can refine).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureDefaultBuckets();
  const body = await req.json().catch(() => ({})) as { year?: number; format?: 'csv' | 'json' };
  const year = body.year ?? new Date().getFullYear();
  const format = body.format ?? 'csv';
  if (format === 'csv' && !(await getRequestFinancialAccess())?.canExportSpace) {
    return NextResponse.json({ error: 'Space export permission is required for tax exports' }, { status: 403 });
  }

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const [buckets, txs] = await Promise.all([
    prisma.taxBucket.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.transaction.findMany({
      where: { date: { gte: start, lte: end }, amount: { lt: 0 }, isTransfer: false, isSplit: false },
      include: { tags: true, category: true, account: { include: { institution: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const compiled = buckets.map(b => ({
    ...b,
    matchers: parseMatchers(b.matchers),
  }));

  // Match each tx → first bucket whose matchers hit. Unmatched go to "Unbucketed".
  type Row = {
    bucket: string; scheduleLine: string;
    date: string; merchant: string; rawDescription: string;
    institution: string; account: string;
    tags: string; category: string;
    amount: number;
  };
  const rows: Row[] = [];
  let totalsByBucket = new Map<string, number>();

  for (const t of txs) {
    const tagNames = new Set(t.tags.map(x => x.name));
    const catName = t.category?.name ?? '';
    let hit = compiled.find(b =>
      b.matchers.some(m =>
        (m.kind === 'tag' && tagNames.has(m.value)) ||
        (m.kind === 'category' && catName === m.value),
      ),
    );
    const bucketName = hit ? `${hit.scheduleLine} - ${hit.name}` : 'Unbucketed';
    const amount = Math.abs(t.amount);
    rows.push({
      bucket: hit?.name ?? 'Unbucketed',
      scheduleLine: hit?.scheduleLine ?? ' - ',
      date: t.date.toISOString().slice(0, 10),
      merchant: t.merchant ?? '',
      rawDescription: t.rawDescription,
      institution: t.account.institution.name,
      account: t.account.name,
      tags: t.tags.map(x => x.name).join('|'),
      category: catName,
      amount,
    });
    totalsByBucket.set(bucketName, (totalsByBucket.get(bucketName) ?? 0) + amount);
  }

  if (format === 'json') {
    return NextResponse.json({
      year,
      totalsByBucket: Object.fromEntries(totalsByBucket),
      grandTotal: [...totalsByBucket.values()].reduce((s, x) => s + x, 0),
      rows,
    });
  }

  const csvEscape = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const headerCsv = ['Schedule line', 'Bucket', 'Date', 'Merchant', 'Description', 'Institution', 'Account', 'Tags', 'Category', 'Amount'];
  const body_lines = rows.map(r => [
    r.scheduleLine, r.bucket, r.date, r.merchant, r.rawDescription, r.institution, r.account, r.tags, r.category, r.amount.toFixed(2),
  ].map(v => csvEscape(String(v))).join(','));

  // Totals footer
  const totalsLines = ['', '# Bucket totals']
    .concat([...totalsByBucket.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${csvEscape(k)},,,,,,,,Total,${v.toFixed(2)}`));

  const csv = [headerCsv.join(','), ...body_lines, ...totalsLines].join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="astroledger-tax-${year}.csv"`,
    },
  });
}
