import { prisma } from '@/lib/prisma';
import { SectionHeader } from '../../../_components/atoms';
import EnvelopesClient from '../../../_components/EnvelopesClient';
import { listEnvelopeProgress, currentMonthYear, getReadyToAssign } from '@/lib/envelopes';
import { listTagsFlat } from '@/lib/tags';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ month?: string }>;

export default async function EnvelopesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const monthYear = (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) ? sp.month : currentMonthYear();
  const [progress, tags, cats, rta] = await Promise.all([
    listEnvelopeProgress(monthYear),
    listTagsFlat(),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    getReadyToAssign(monthYear),
  ]);

  // For the copy-from picker, list every month with at least one envelope
  // - gives the user a one-click "duplicate last month" affordance.
  const months = (await prisma.envelope.findMany({
    select: { monthYear: true }, distinct: ['monthYear'], orderBy: { monthYear: 'desc' }, take: 24,
  })).map(m => m.monthYear);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`Month ${monthYear}`}
        title="Envelopes"
        subtitle="Allocate each dollar before you spend it. Envelopes track a tag (recommended - uses the tag hierarchy) or a category. Spent column updates live."
      />

      <EnvelopesClient
        monthYear={monthYear}
        progress={progress}
        tags={tags.map(t => ({ id: t.id, name: t.name, parentName: t.parentName ?? null }))}
        categories={cats.map(c => ({ id: c.id, name: c.name }))}
        availableMonths={months}
        readyToAssign={rta}
      />
    </div>
  );
}
