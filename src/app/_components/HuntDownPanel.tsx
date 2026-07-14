'use client';
import { useState } from 'react';
import { Btn, fmt, fmtDate } from './atoms';

type HuntResult = {
  source: {
    id: string;
    date: string;
    amount: number;
    merchant: string;
    rawDescription: string;
    account: string;
  };
  relatedTransactions: Array<{
    id: string; date: string; amount: number; merchant: string; account: string;
  }>;
  recurrenceHint: {
    count: number;
    firstSeen: string | null;
    lastSeen: string | null;
    totalSpent: number;
    avgDaysBetween: number | null;
    suspectedSubscription: boolean;
    matchingSubscription: { id: string; merchant: string; cadence: string; amount: number } | null;
  };
  matchingOrders: Array<{
    id: string; source: string; orderDate: string; merchant: string; amount: number;
    snippet: string | null; url: string | null;
  }>;
  searchTokens: string[];
  llm: {
    available: boolean;
    summary: string | null;
    cancelSteps: string[];
    likelyService: string | null;
  };
};

export default function HuntDownPanel({ txId, rawDescription }: { txId: string; rawDescription: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HuntResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hunt() {
    if (open && result) { setOpen(!open); return; }
    setOpen(true); setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/transactions/${txId}/hunt`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Hunt failed');
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Btn variant="outline" size="sm" onClick={hunt} disabled={busy}>
        {busy ? '🔍 Hunting…' : open ? '🔍 Hide hunt' : '🔍 Hunt down'}
      </Btn>
      {open && (
        <div style={{
          marginTop: 12, padding: 14,
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
          {busy && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Querying transactions, orders, and the local LLM…</div>}
          {result && (
            <>
              {/* Recurrence header */}
              <div>
                <div className="t-caption" style={{ marginBottom: 6 }}>What we know</div>
                <div style={{ fontSize: 13, color: 'var(--fg-strong)', marginBottom: 6 }}>
                  This charge has appeared <strong>{result.recurrenceHint.count}× </strong>
                  totaling <strong>{fmt(result.recurrenceHint.totalSpent, { cents: false })}</strong>
                  {result.recurrenceHint.firstSeen && (
                    <span> since {fmtDate(result.recurrenceHint.firstSeen)}</span>
                  )}
                  {result.recurrenceHint.avgDaysBetween !== null && (
                    <span> · avg every {result.recurrenceHint.avgDaysBetween} days</span>
                  )}.
                </div>
                {result.recurrenceHint.matchingSubscription ? (
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    ↻ Linked subscription: {result.recurrenceHint.matchingSubscription.merchant} · {result.recurrenceHint.matchingSubscription.cadence} · {fmt(result.recurrenceHint.matchingSubscription.amount)}
                  </div>
                ) : result.recurrenceHint.suspectedSubscription && (
                  <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                    ⚠ This looks like a monthly subscription that isn't tracked yet.
                  </div>
                )}
              </div>

              {/* LLM analysis */}
              {result.llm.available && (result.llm.likelyService || result.llm.summary) && (
                <div style={{
                  padding: 12, background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
                }}>
                  <div className="t-caption" style={{ marginBottom: 6, color: 'var(--accent)' }}>LLM analysis</div>
                  {result.llm.likelyService && (
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)', marginBottom: 4 }}>
                      Likely: {result.llm.likelyService}
                    </div>
                  )}
                  {result.llm.summary && (
                    <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5, marginBottom: result.llm.cancelSteps.length > 0 ? 10 : 0 }}>
                      {result.llm.summary}
                    </div>
                  )}
                  {result.llm.cancelSteps.length > 0 && (
                    <>
                      <div className="t-caption" style={{ marginBottom: 4 }}>How to cancel</div>
                      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
                        {result.llm.cancelSteps.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    </>
                  )}
                </div>
              )}
              {!result.llm.available && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  Local LLM unreachable - start Ollama to get an analysis + cancel-steps suggestion.
                </div>
              )}

              {/* Matching orders */}
              {result.matchingOrders.length > 0 && (
                <div>
                  <div className="t-caption" style={{ marginBottom: 6 }}>
                    Matching email receipts ({result.matchingOrders.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                    {result.matchingOrders.map(o => (
                      <div key={o.id} style={{
                        padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
                        background: 'var(--bg)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{o.merchant}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
                            {fmtDate(o.orderDate)} · {fmt(o.amount)} · {o.source}
                          </span>
                        </div>
                        {o.snippet && (
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                            {o.snippet}
                          </div>
                        )}
                        {o.url && (
                          <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, display: 'inline-block' }}>
                            Open ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.matchingOrders.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  No email receipts matched the merchant tokens [{result.searchTokens.join(', ')}]. Import a Gmail archive or sync your inbox to find receipts.
                </div>
              )}

              {/* Related transactions */}
              {result.relatedTransactions.length > 0 && (
                <div>
                  <div className="t-caption" style={{ marginBottom: 6 }}>
                    Other charges to this merchant ({result.relatedTransactions.length})
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {result.relatedTransactions.slice(0, 30).map(r => (
                      <div key={r.id} style={{
                        display: 'grid', gridTemplateColumns: '80px 1fr 100px 90px', gap: 8,
                        padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono)',
                        color: 'var(--fg-muted)',
                      }}>
                        <span>{fmtDate(r.date)}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.merchant}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>{r.account}</span>
                        <span style={{ textAlign: 'right', color: r.amount < 0 ? 'var(--accent)' : 'var(--success)' }}>
                          {r.amount > 0 ? '+' : ''}{r.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
