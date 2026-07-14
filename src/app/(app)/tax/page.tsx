import { prisma } from '@/lib/prisma';
import { Card, SectionHeader } from '../../_components/atoms';
import TaxClient from '../../_components/TaxClient';
import { ensureDefaultBuckets, parseMatchers } from '@/lib/taxBuckets';
import { listTagsFlat } from '@/lib/tags';

export const dynamic = 'force-dynamic';

export default async function TaxPage() {
  await ensureDefaultBuckets();
  const [buckets, tags, cats] = await Promise.all([
    prisma.taxBucket.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    listTagsFlat(),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Schedule C"
        title="Tax export"
        subtitle="Map your tags and categories to IRS Schedule C lines, then export the year as a CSV grouped by bucket. Bring this into your tax prep tool or hand it to your accountant."
      />
      <TaxClient
        buckets={buckets.map(b => ({
          id: b.id,
          scheduleLine: b.scheduleLine,
          name: b.name,
          matchers: parseMatchers(b.matchers),
          notes: b.notes,
          sortOrder: b.sortOrder,
        }))}
        tags={tags.map(t => ({ id: t.id, name: t.name, parentName: t.parentName ?? null }))}
        categories={cats.map(c => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
