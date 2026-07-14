import { SectionHeader } from '../../_components/atoms';
import BillsClient from '../../_components/BillsClient';
import { getBillDashboard } from '@/lib/bills';

export const dynamic = 'force-dynamic';

export default async function BillsPage() {
  const dashboard = await getBillDashboard();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${dashboard.occurrences.length} tracked occurrence${dashboard.occurrences.length === 1 ? '' : 's'} · next 60 days`}
        title="Bills"
        subtitle="Know what is due, what was actually paid, and which transaction settled it. Fixed and variable obligations keep their own monthly history without changing the recurring source."
      />
      <BillsClient dashboard={dashboard} />
    </div>
  );
}
