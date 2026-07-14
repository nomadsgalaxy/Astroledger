import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SectionHeader } from '../../../_components/atoms';
import ScheduleClient from '../../../_components/ScheduleClient';
import { monthlyCommitments, upcomingEvents } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const [schedules, commitments, upcoming] = await Promise.all([
    prisma.schedule.findMany({ orderBy: { nextDate: 'asc' } }),
    monthlyCommitments(),
    upcomingEvents(60),
  ]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Recurring"
        title="Schedule"
        subtitle="Everything that recurs in one place — auto-detected subscriptions plus the income and bills you track manually. See what it nets to each month and what's coming up; manual entries also feed the cashflow forecast."
      />
      <ScheduleClient
        initialSchedules={schedules.map(s => ({ id: s.id, name: s.name, amount: s.amount, cadenceDays: s.cadenceDays, nextDate: s.nextDate.toISOString().slice(0, 10), active: s.active }))}
        commitments={commitments}
        upcoming={upcoming}
      />
    </div>
  );
}
