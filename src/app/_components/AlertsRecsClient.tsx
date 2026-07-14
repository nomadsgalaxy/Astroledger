'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, fmt, fmtDate } from './atoms';

export type RecIntel = {
  subject: string;
  cadence?: string | null;
  subStatus?: string | null;
  estMonthly?: number | null;
  history: Array<{ date: string; amount: number; merchant: string; account?: string | null }>;
  total?: number;
};

export type Recommendation = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  monthlySavings: number | null;
  refType: string | null;
  refId: string | null;
  status: string;
};

const KIND_LABELS: Record<string, { label: string; tone: 'warning' | 'error' | 'info' | 'success' }> = {
  duplicate_sub: { label: 'Duplicate subscription', tone: 'warning' },
  unused_sub:    { label: 'Possibly unused',         tone: 'warning' },
  price_hike:    { label: 'Price increase',          tone: 'error' },
  over_avg:      { label: 'Heavy spend',             tone: 'warning' },
  new_recurring: { label: 'New recurring charge',    tone: 'info' },
};

// Per-kind primary action wording. Each rec gets one focused button rather
// than a generic "Act" — context makes the right choice obvious.
function primaryActionLabel(kind: string): string {
  switch (kind) {
    case 'duplicate_sub': return 'Cancel subscription';
    case 'unused_sub':    return 'Cancel subscription';
    case 'price_hike':    return 'Acknowledge';
    case 'over_avg':      return 'Acknowledge';
    case 'new_recurring': return 'Confirm cancelled';
    default:              return 'Mark done';
  }
}

export default function AlertsRecsClient({
  recs,
  intel,
}: {
  recs: Recommendation[];
  intel: Record<string, RecIntel | null>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function patch(id: string, status: 'dismissed' | 'done' | 'open') {
    setBusy(id);
    try {
      await fetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setOpen(null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (recs.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>
        No recommendations yet. Run subscription detection after importing transactions.
      </div>
    );
  }

  return (
    <>
      {recs.map(r => {
        const meta = KIND_LABELS[r.kind] ?? { label: r.kind, tone: 'info' as const };
        const disabled = r.status !== 'open' || busy === r.id;
        return (
          <div key={r.id} style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'var(--cols)',
            gap: 18,
            alignItems: 'center',
            opacity: r.status === 'open' ? 1 : 0.55,
          }}>
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                <Pill tone={meta.tone}>{meta.label}</Pill>
                {r.status !== 'open' && <Pill tone="ghost">{r.status}</Pill>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.5 }}>{r.detail}</div>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14,
              color: r.monthlySavings ? 'var(--accent)' : 'var(--fg-muted)',
              textAlign: 'right',
            }}>
              {r.monthlySavings ? `~${fmt(r.monthlySavings, { cents: false })}/mo` : ' - '}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" disabled={disabled} onClick={() => patch(r.id, 'dismissed')}>
                Dismiss
              </Btn>
              <Btn variant="outline" size="sm" disabled={r.status !== 'open'} onClick={() => setOpen(r.id)}>
                Act
              </Btn>
            </div>
          </div>
        );
      })}

      {open && (() => {
        const rec = recs.find(r => r.id === open);
        if (!rec) return null;
        const i = intel[rec.id] ?? null;
        return (
          <ActModal
            rec={rec}
            intel={i}
            busy={busy === rec.id}
            onClose={() => setOpen(null)}
            onDismiss={() => patch(rec.id, 'dismissed')}
            onConfirm={() => patch(rec.id, 'done')}
          />
        );
      })()}
    </>
  );
}

function ActModal({
  rec,
  intel,
  busy,
  onClose,
  onDismiss,
  onConfirm,
}: {
  rec: Recommendation;
  intel: RecIntel | null;
  busy: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const meta = KIND_LABELS[rec.kind] ?? { label: rec.kind, tone: 'info' as const };
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Act on ${rec.title}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
        display: 'grid', placeItems: 'center', padding: 20,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(640px, calc(100vw - 40px))',
        // Modal frame is FIXED — title block + history summary stay visible
        // at the top, action buttons stay pinned at the bottom, and only the
        // payment-history row list scrolls inside (handled in HistoryTable).
        maxHeight: '88vh', overflow: 'hidden',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <Pill tone={meta.tone}>{meta.label}</Pill>
            {rec.monthlySavings ? (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                color: 'var(--accent)',
              }}>~{fmt(rec.monthlySavings, { cents: false })}/mo</span>
            ) : null}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>{rec.title}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.5 }}>{rec.detail}</div>
        </div>

        <div style={{
          padding: '16px 24px 8px',
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          // Section header stays put; the row list inside HistoryTable owns
          // its own scroll so the title/summary tiles don't disappear when
          // the user scans a long history.
        }}>
          <div className="t-caption" style={{ marginBottom: 10, flexShrink: 0 }}>Payment history</div>
          {intel === null || intel.history.length === 0 ? (
            <div style={{
              padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13,
              border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)',
            }}>
              No prior charges found for this rec.
            </div>
          ) : (
            <HistoryTable intel={intel} />
          )}
        </div>

        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--fg-subtle)' }}>
            {rec.refType === 'subscription'
              ? '"Cancel subscription" also flips the subscription to canceled in /subscriptions.'
              : '"Acknowledge" marks this recommendation done. Reversible from the database directly.'}
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Btn>
          <Btn variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>Dismiss</Btn>
          <Btn variant="primary" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Saving...' : primaryActionLabel(rec.kind)}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function HistoryTable({ intel }: { intel: RecIntel }) {
  // Summary header: total + cadence + last charge
  const last = intel.history[0];
  const total = intel.total ?? intel.history.reduce((s, h) => s + Math.abs(h.amount), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Summary tiles — fixed at the top of the body section */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        padding: '10px 14px', background: 'var(--bg-subtle)',
        borderRadius: 'var(--r-sm)', marginBottom: 12, fontSize: 12,
        flexShrink: 0,
      }}>
        <div>
          <div className="t-caption" style={{ fontSize: 9 }}>Subject</div>
          <div style={{ marginTop: 2, fontWeight: 600, color: 'var(--fg-strong)' }}>{intel.subject}</div>
        </div>
        <div>
          <div className="t-caption" style={{ fontSize: 9 }}>Total seen</div>
          <div style={{ marginTop: 2, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-strong)' }}>
            {fmt(total, { cents: false })}
          </div>
        </div>
        <div>
          <div className="t-caption" style={{ fontSize: 9 }}>{intel.cadence ? 'Cadence' : 'Last seen'}</div>
          <div style={{ marginTop: 2, color: 'var(--fg-strong)' }}>
            {intel.cadence ?? (last ? fmtDate(last.date) : ' - ')}
          </div>
        </div>
      </div>

      {/* Table — header is sticky at the top of the scroll container,
          rows scroll inside. The container takes whatever vertical space
          is left in the modal body and no more. */}
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '110px 1fr 110px',
          padding: '8px 14px', background: 'var(--bg-subtle)',
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 9,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          color: 'var(--fg-muted)',
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          <div>Date</div>
          <div>Merchant / Account</div>
          <div style={{ textAlign: 'right' }}>Amount</div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {intel.history.map((h, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '110px 1fr 110px',
              padding: '8px 14px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              fontSize: 12, alignItems: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{fmtDate(h.date)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--fg-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.merchant}
                </div>
                {h.account && (
                  <div style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{h.account}</div>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'right',
                            color: h.amount < 0 ? 'var(--fg-strong)' : 'var(--success)' }}>
                {h.amount < 0 ? '-' : '+'}{fmt(Math.abs(h.amount), { cents: false })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
