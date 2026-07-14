import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SectionHeader } from '../../../_components/atoms';
import DebtClient from '../../../_components/DebtClient';
import { buildDebtPlan } from '@/lib/debt';

export const dynamic = 'force-dynamic';

export default async function DebtPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const plan = await buildDebtPlan();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Debt payoff"
        title="Payoff planner"
        subtitle="Compare the avalanche (highest APR first) and snowball (smallest balance first) strategies across your credit and loan accounts — see when you'll be debt-free and how much interest each approach costs."
      />
      <DebtClient initial={plan} />
    </div>
  );
}
