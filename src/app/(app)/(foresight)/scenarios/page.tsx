import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SectionHeader } from '../../../_components/atoms';
import ScenariosClient from '../../../_components/ScenariosClient';
import { headlineRunway } from '@/lib/scenarios';

export const dynamic = 'force-dynamic';

export default async function ScenariosPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const [scenarios, runway] = await Promise.all([
    prisma.scenario.findMany({ include: { adjustments: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    headlineRunway(),
  ]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="What-if"
        title="Scenarios & runway"
        subtitle="See how long your savings last at your current cashflow — then stack what-if adjustments (a raise, a new cost, cutting a subscription) and watch the trajectory change. Toggle scenarios into the headline to combine them."
      />
      <ScenariosClient
        initialScenarios={scenarios.map(s => ({
          id: s.id, name: s.name, active: s.active,
          adjustments: s.adjustments.map(a => ({ id: a.id, label: a.label, monthlyDelta: a.monthlyDelta })),
        }))}
        initialRunway={runway}
      />
    </div>
  );
}
