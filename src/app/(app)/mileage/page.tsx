import { prisma } from '@/lib/prisma';
import { Card, SectionHeader } from '../../_components/atoms';
import MileageClient from '../../_components/MileageClient';
import { listTagsFlat } from '@/lib/tags';

export const dynamic = 'force-dynamic';

export default async function MileagePage() {
  const [logs, tags, accounts] = await Promise.all([
    prisma.mileageLog.findMany({ orderBy: { date: 'desc' }, take: 500 }),
    listTagsFlat(),
    prisma.bankAccount.findMany({
      include: { institution: { select: { name: true } } },
      orderBy: [{ name: 'asc' }],
    }),
  ]);

  const ytdStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const ytd = logs.filter(l => l.date >= ytdStart);
  const ytdMiles = ytd.reduce((s, l) => s + l.miles, 0);
  const ytdDollars = ytd.reduce((s, l) => s + l.miles * l.ratePerMile, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${logs.length} log${logs.length === 1 ? '' : 's'} · ${ytd.length} this year`}
        title="Mileage"
        subtitle="Track business miles at the IRS standard rate (2026 = $0.67/mi). Convert any log to an anticipated transaction tagged for deduction."
      />

      <MileageClient
        logs={logs.map(l => ({
          id: l.id,
          date: l.date.toISOString().slice(0, 10),
          miles: l.miles,
          purpose: l.purpose,
          ratePerMile: l.ratePerMile,
          tagId: l.tagId,
          notes: l.notes,
          transactionId: l.transactionId,
        }))}
        tags={tags}
        accounts={accounts.map(a => ({
          id: a.id,
          label: `${a.institution.name} ${a.mask ? `· ${a.mask}` : ''} (${a.name})`,
        }))}
        ytdMiles={ytdMiles}
        ytdDollars={ytdDollars}
      />
    </div>
  );
}
