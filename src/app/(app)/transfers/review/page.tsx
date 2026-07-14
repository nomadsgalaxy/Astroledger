import { findAmbiguousTransfers } from '@/lib/transferReview';
import { Card, SectionHeader } from '../../../_components/atoms';
import TransferReviewClient from '../../../_components/TransferReviewClient';

export const dynamic = 'force-dynamic';

export default async function TransferReviewPage() {
  const groups = await findAmbiguousTransfers({ rangeDays: 3 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${groups.length} ambiguous group${groups.length === 1 ? '' : 's'}`}
        title="Transfer review"
        subtitle="Outflows where the automatic matcher couldn't decide between multiple same-amount inflows. Pick the right inflow for each, dismiss if it isn't a transfer at all, or skip and come back later. The matcher will leave dismissed rows alone on future runs."
      />

      {groups.length === 0 ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 8 }}>All clear</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
              No ambiguous transfer candidates right now. New imports will surface here if the matcher abstains.
            </div>
          </div>
        </Card>
      ) : (
        <TransferReviewClient initialGroups={groups} />
      )}
    </div>
  );
}
