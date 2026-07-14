import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SectionHeader, Btn } from '../../../../_components/atoms';
import ReconcileClient from '../../../../_components/ReconcileClient';
import { getReconcileState } from '@/lib/reconciliation';

export const dynamic = 'force-dynamic';

export default async function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const { id } = await params;

  const state = await getReconcileState(id);
  if (!state) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Reconcile"
        title={state.account.name}
        subtitle="Match Astroledger against a bank or card statement, one period at a time. Cleared rows lock once the books tie out."
        right={<Link href="/accounts"><Btn variant="outline" size="md" icon="←">Back to accounts</Btn></Link>}
      />
      <ReconcileClient
        accountId={state.account.id}
        accountName={state.account.name}
        currency={state.account.currency}
        bookBalance={state.bookBalance}
        initialClearedBalance={state.clearedBalance}
        reconciledBalance={state.reconciledBalance}
        lockedCount={state.lockedCount}
        olderUnclearedCount={state.olderUnclearedCount}
        reconciledAsOf={state.account.reconciledAsOf ? state.account.reconciledAsOf.toISOString() : null}
        txns={state.txns.map(t => ({
          id: t.id, date: t.date.toISOString(), merchant: t.merchant,
          rawDescription: t.rawDescription, amount: t.amount, cleared: t.cleared, locked: t.locked,
        }))}
      />
    </div>
  );
}
