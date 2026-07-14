'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Btn, Pill, fmt, fmtDate } from './atoms';
import MerchantNameEdit from './MerchantNameEdit';
import TagPicker from './TagPicker';
import type { TransactionIntel } from '@/lib/entityIntel';

/**
 * Globally-mounted in Shell. Reads `?tx=<id>` from the URL; when present,
 * fetches /api/transactions/:id/intel and shows a modal. Closing the modal
 * pops the `tx` param off the URL (preserves any other params).
 *
 * Open from anywhere via the exported `openTransaction(id, router)` helper
 * OR with `<Link href={`?tx=${id}`}>` (relative - keeps the current path).
 */
export default function TransactionDetailModal() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const txId = params.get('tx');

  const [intel, setIntel] = useState<TransactionIntel | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Build the close href: keep the same path, drop `tx`, keep all other params.
  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('tx');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, params, router]);

  useEffect(() => {
    if (!txId) { setIntel(null); setErr(null); return; }
    let cancelled = false;
    setLoading(true); setErr(null);
    fetch(`/api/transactions/${txId}/intel`, { cache: 'no-store' })
      .then(async r => {
        if (cancelled) return;
        if (!r.ok) { setErr(`Could not load (${r.status})`); setLoading(false); return; }
        const j = await r.json() as TransactionIntel;
        setIntel(j); setNoteDraft(j.transaction.notes ?? '');
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setErr(e?.message ?? 'Network error'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [txId]);

  // Esc to close
  useEffect(() => {
    if (!txId) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [txId, close]);

  if (!txId) return null;

  async function saveNotes() {
    if (!intel) return;
    await fetch(`/api/transactions/${intel.transaction.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: noteDraft }),
    });
  }
  async function toggleTransfer() {
    if (!intel) return;
    await fetch(`/api/transactions/${intel.transaction.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTransfer: !intel.transaction.isTransfer }),
    });
    router.refresh();
    setIntel({ ...intel, transaction: { ...intel.transaction, isTransfer: !intel.transaction.isTransfer } });
  }

  return (
    <div onClick={close} role="dialog" aria-modal="true" aria-label="Transaction details" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'grid', placeItems: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        // `min(760px, 100%)` instead of `width: 760, maxWidth: '100%'` - 
        // the outer grid track auto-expands to its child's width, so plain
        // `maxWidth: 100%` never bites. `min()` clamps to viewport width
        // (less the overlay's 20px padding on each side) on mobile.
        width: 'min(760px, calc(100vw - 40px))',
        maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column',
      }}>
        {loading && <div style={{ padding: 60, textAlign: 'center', color: 'var(--fg-muted)' }}>Loading…</div>}
        {err && <div style={{ padding: 30, color: 'var(--error)' }}>Error: {err}<div style={{ marginTop: 12 }}><Btn variant="ghost" onClick={close}>Close</Btn></div></div>}
        {intel && !loading && (
          <>
            {/* Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                  {intel.transaction.date.slice(0, 10)} · {intel.transaction.account.institution} · {intel.transaction.account.name}{intel.transaction.account.mask ? ` (${intel.transaction.account.mask})` : ''}
                </div>
                <MerchantNameEdit
                  transactionId={intel.transaction.id}
                  initialMerchant={intel.transaction.merchant ?? intel.transaction.rawDescription.slice(0, 40)}
                  rawDescription={intel.transaction.rawDescription}
                  textStyle={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-strong)' }}
                />
                {intel.transaction.rawDescription !== intel.transaction.merchant && (
                  <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    raw: {intel.transaction.rawDescription}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 24, color: intel.transaction.amount > 0 ? 'var(--success)' : 'var(--fg-strong)' }}>
                  {intel.transaction.amount > 0 ? '+' : '−'}
                  {intel.transaction.currency !== 'USD' ? `${Math.abs(intel.transaction.amount).toFixed(2)} ${intel.transaction.currency}` : fmt(Math.abs(intel.transaction.amount))}
                </div>
                {intel.transaction.currency !== 'USD' && intel.transaction.baseAmount != null && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                    ≈ {intel.transaction.amount > 0 ? '+' : '−'}{fmt(Math.abs(intel.transaction.baseAmount))} USD
                  </div>
                )}
                {intel.transaction.currency !== 'USD' && intel.transaction.baseAmount == null && (
                  <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>
                    No FX rate on file
                  </div>
                )}
              </div>
              <button onClick={close} title="Close (Esc)"
                      style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
                ×
              </button>
            </div>

            {/* Quick flags + tag picker row */}
            <div style={{ padding: '10px 22px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              {intel.transaction.isTransfer && <Pill tone="info">Transfer</Pill>}
              {intel.transaction.isAnticipated && <Pill tone="warning">Anticipated</Pill>}
              {/* Editable tag chips. Adds/removes call the same /api/transactions/:id/tags
                  endpoint that other surfaces use, so changes show up everywhere. */}
              <TagPicker
                scope="transaction"
                entityId={intel.transaction.id}
                initial={intel.transaction.tags}
                compact
              />
              <div style={{ flex: 1 }} />
              <Link href={`/transactions/${intel.transaction.id}/split`} style={{ ...smallBtn, textDecoration: 'none' }}>
                ⫶ Split…
              </Link>
              <button onClick={toggleTransfer} style={smallBtn}>
                {intel.transaction.isTransfer ? '↶ Unmark transfer' : '⇆ Mark as transfer'}
              </button>
            </div>

            {/* Context body */}
            <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Merchant history */}
              {intel.merchantHistory.count > 0 && (
                <Section title="Merchant history">
                  <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 8 }}>
                    <strong>{intel.merchantHistory.count}</strong> other charges from this merchant - total <strong style={{ fontFamily: 'var(--font-mono)' }}>{fmt(intel.merchantHistory.sumOut)}</strong> out, <strong style={{ fontFamily: 'var(--font-mono)' }}>{fmt(intel.merchantHistory.sumIn)}</strong> in.
                    {intel.merchantHistory.first && intel.merchantHistory.last && (
                      <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>
                        ({intel.merchantHistory.first.slice(0, 10)} → {intel.merchantHistory.last.slice(0, 10)})
                      </span>
                    )}
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                    {intel.merchantHistory.lastFive.map(t => (
                      <Link key={t.id} href={`?tx=${t.id}`} style={lastRow}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', minWidth: 80 }}>{t.date}</span>
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.rawDescription}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: t.amount > 0 ? 'var(--success)' : 'var(--fg-strong)' }}>
                          {t.amount > 0 ? '+' : '−'}{fmt(Math.abs(t.amount))}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Section>
              )}

              {/* Subscription */}
              {intel.subscription && (
                <Section title="Linked subscription">
                  <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{intel.subscription.merchant}</span>
                    <Pill tone="info">{intel.subscription.cadence}</Pill>
                    <div style={{ flex: 1 }} />
                    <Link href={`/subscriptions#${intel.subscription.id}`} style={{ ...smallBtn, textDecoration: 'none' }}>View →</Link>
                  </div>
                </Section>
              )}

              {/* Receipts / orders */}
              {intel.orders.length > 0 && (
                <Section title={`Email receipt${intel.orders.length === 1 ? '' : 's'}`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {intel.orders.map(o => (
                      <div key={o.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{o.date} · {o.source}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{fmt(o.amount)}</span>
                        </div>
                        {o.items && <div style={{ fontSize: 11, color: 'var(--fg)' }}>{o.items.slice(0, 200)}</div>}
                        {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)' }}>Open →</a>}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Same-amount neighbors (transfer candidates / dupes) */}
              {intel.sameAmountNeighbors.length > 0 && (
                <Section title="Same-amount neighbors (±5 days)">
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6 }}>
                    Possible transfer pair or duplicate. Click to inspect.
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                    {intel.sameAmountNeighbors.map(n => (
                      <Link key={n.id} href={`?tx=${n.id}`} style={lastRow}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', minWidth: 80 }}>{n.date}</span>
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--fg)' }}>{n.merchant ?? ' - '} <span style={{ color: 'var(--fg-subtle)' }}>· {n.account}</span></span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: n.amount > 0 ? 'var(--success)' : 'var(--fg-strong)' }}>
                          {n.amount > 0 ? '+' : '−'}{fmt(Math.abs(n.amount))}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Section>
              )}

              {/* Notes */}
              <Section title="Notes (private)">
                <textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  onBlur={saveNotes}
                  placeholder="Free-form notes - saved on blur."
                  rows={2}
                  style={{
                    width: '100%', padding: 10, resize: 'vertical',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                    background: 'var(--bg)', color: 'var(--fg)',
                    fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
                  }}
                />
              </Section>
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              <Link href={`/transactions?date=${intel.transaction.date.slice(0,10)}`} style={{ ...smallBtn, textDecoration: 'none' }}>
                See full day →
              </Link>
              <div style={{ flex: 1 }} />
              <Btn variant="primary" onClick={close}>Done</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const lastRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 12px', borderBottom: '1px solid var(--border)',
  textDecoration: 'none', color: 'inherit',
  cursor: 'pointer',
};

const smallBtn: React.CSSProperties = {
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--fg-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 5, lineHeight: 1, boxSizing: 'border-box',
};
