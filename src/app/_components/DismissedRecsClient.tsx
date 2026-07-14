'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, fmt } from './atoms';

const KIND_LABELS: Record<string, { label: string; tone: 'warning' | 'error' | 'info' | 'success' }> = {
  duplicate_sub: { label: 'Duplicate subscription', tone: 'warning' },
  unused_sub:    { label: 'Possibly unused',         tone: 'warning' },
  price_hike:    { label: 'Price increase',          tone: 'error' },
  over_avg:      { label: 'Heavy spend',             tone: 'warning' },
  new_recurring: { label: 'New recurring charge',    tone: 'info' },
};

type DismissedRec = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  monthlySavings: number | null;
  dismissedAt: string | null;
  daysLeft: number;
};

export default function DismissedRecsClient({ recs }: { recs: DismissedRec[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function reopen(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {recs.map(r => {
        const meta = KIND_LABELS[r.kind] ?? { label: r.kind, tone: 'info' as const };
        const expiring = r.daysLeft <= 2;
        return (
          <div key={r.id} style={{
            padding: '14px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: '1fr 110px 110px',
            gap: 18,
            alignItems: 'center',
            opacity: 0.75,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                <Pill tone={meta.tone}>{meta.label}</Pill>
                <Pill tone="ghost">dismissed</Pill>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-strong)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.5,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden' }}>{r.detail}</div>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
              color: expiring ? 'var(--error)' : 'var(--fg-muted)',
              textAlign: 'right',
            }}>
              {r.daysLeft === 0 ? 'expires today' : `${r.daysLeft}d left`}
              {r.monthlySavings ? (
                <div style={{ fontSize: 10, color: 'var(--fg-subtle)', fontWeight: 400, marginTop: 2 }}>
                  was ~{fmt(r.monthlySavings, { cents: false })}/mo
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn variant="outline" size="sm" disabled={busy === r.id} onClick={() => reopen(r.id)}>
                {busy === r.id ? 'Restoring…' : 'Restore'}
              </Btn>
            </div>
          </div>
        );
      })}
    </>
  );
}
