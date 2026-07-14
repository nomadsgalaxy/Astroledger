'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill, fmt } from './atoms';
import type { AmbiguousGroup, CandidateSide } from '@/lib/transferReview';

// Interactive UI for the /transfers/review page. Each ambiguous outflow is a
// card; the user either picks the matching inflow + "Pair", dismisses the
// outflow + all candidates as "Not a transfer", or skips to the next.
export default function TransferReviewClient({ initialGroups }: { initialGroups: AmbiguousGroup[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [busy, setBusy] = useState<string | null>(null); // outflowId currently being acted on

  async function pair(outflowId: string, inflowId: string) {
    setBusy(outflowId);
    const r = await fetch('/api/transfers/pair-manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outflowId, inflowId }),
    });
    if (r.ok) {
      // Drop this group from the list; also drop any other groups whose
      // candidates included the inflow we just claimed (it can't double-pair).
      setGroups(prev => prev
        .filter(g => g.outflow.id !== outflowId)
        .map(g => ({ ...g, candidates: g.candidates.filter(c => c.id !== inflowId) }))
        .filter(g => g.candidates.length >= 1));
    } else {
      const j = await r.json().catch(() => ({ error: r.statusText }));
      alert('Pair failed: ' + (j.error ?? 'unknown'));
    }
    setBusy(null);
    router.refresh();
  }

  async function dismiss(outflowId: string, alsoCandidateIds: string[] = []) {
    setBusy(outflowId);
    // Dismiss just the outflow by default; user can opt to "this isn't related
    // to any of these" → dismiss the inflows too.
    const r = await fetch('/api/transfers/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txIds: [outflowId, ...alsoCandidateIds] }),
    });
    if (r.ok) {
      setGroups(prev => prev.filter(g => g.outflow.id !== outflowId));
    } else {
      const j = await r.json().catch(() => ({ error: r.statusText }));
      alert('Dismiss failed: ' + (j.error ?? 'unknown'));
    }
    setBusy(null);
    router.refresh();
  }

  function skip(outflowId: string) {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.outflow.id === outflowId);
      if (idx < 0) return prev;
      const rest = [...prev];
      const [g] = rest.splice(idx, 1);
      rest.push(g); // move to end of list
      return rest;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(g => (
        <GroupCard
          key={g.outflow.id}
          group={g}
          busy={busy === g.outflow.id}
          onPair={pair}
          onDismiss={dismiss}
          onSkip={() => skip(g.outflow.id)}
        />
      ))}
    </div>
  );
}

function GroupCard({ group, busy, onPair, onDismiss, onSkip }: {
  group: AmbiguousGroup;
  busy: boolean;
  onPair: (outflowId: string, inflowId: string) => void;
  onDismiss: (outflowId: string, alsoCandidateIds?: string[]) => void;
  onSkip: () => void;
}) {
  // Pre-select the hint-matched candidate if any, else the closest-by-date.
  // findAmbiguousTransfers already sorts so hint-matches come first.
  const [selected, setSelected] = useState<string | null>(
    group.candidates.find(c => c.matchesHint)?.id ?? group.candidates[0]?.id ?? null,
  );

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--bg-elevated)', overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
        <SideRow side={group.outflow} role="outflow" />
      </div>

      <div style={{ padding: '8px 18px 0', fontSize: 11, color: 'var(--fg-muted)', letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>
        Pair with which inflow?
      </div>

      <div style={{ padding: '8px 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.candidates.map(c => (
          <label key={c.id}
                 title={c.matchesHint ? 'The outflow\'s description references this account\'s mask - likely the correct pair.' : undefined}
                 style={{
                   display: 'flex', alignItems: 'center', gap: 10,
                   padding: '10px 12px', borderRadius: 'var(--r-sm)',
                   border: `1px solid ${selected === c.id ? 'var(--accent)' : (c.matchesHint ? 'var(--success)' : 'var(--border)')}`,
                   cursor: 'pointer',
                   background: selected === c.id ? 'rgba(253, 80, 0, 0.06)' : (c.matchesHint ? 'rgba(60, 180, 90, 0.04)' : 'transparent'),
                 }}>
            <input type="radio" name={`grp-${group.outflow.id}`}
                   checked={selected === c.id}
                   onChange={() => setSelected(c.id)}
                   style={{ accentColor: 'var(--accent)' }} />
            <div style={{ flex: 1 }}>
              <SideRow side={c} role="inflow" />
            </div>
            {c.matchesHint && (
              <Pill tone="success" style={{ fontSize: 9, padding: '2px 7px' }}>
                ↳ MASK MATCH
              </Pill>
            )}
          </label>
        ))}
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn variant="primary" onClick={() => selected && onPair(group.outflow.id, selected)} disabled={!selected || busy}>
          {busy ? 'Pairing…' : '✓ Pair selected'}
        </Btn>
        <Btn variant="outline" onClick={onSkip} disabled={busy}>Skip for now</Btn>
        <div style={{ flex: 1 }} />
        <span title="Mark the outflow as not a transfer. The candidate inflows are left alone.">
          <Btn variant="ghost" onClick={() => onDismiss(group.outflow.id)} disabled={busy}>
            ✕ Not a transfer
          </Btn>
        </span>
        <span title="Mark the outflow AND all candidate inflows as not transfers.">
          <Btn variant="ghost" onClick={() => onDismiss(group.outflow.id, group.candidates.map(c => c.id))} disabled={busy}>
            ✕ None of these
          </Btn>
        </span>
      </div>
    </div>
  );
}

// Source-pill colors: live connectors (Plaid, SimpleFIN, PayPal) get a
// success tone because they're high-fidelity; file imports get warning
// (QIF/PDF) or info (CSV/OFX/QFX); manual/probe get ghost. Helps the user
// trust the more authoritative side at a glance.
function sourcePillTone(source: string): 'success' | 'info' | 'warning' | 'ghost' {
  switch (source) {
    case 'plaid':
    case 'simplefin':
    case 'paypal':    return 'success';
    case 'csv':
    case 'ofx':
    case 'qfx':       return 'info';
    case 'qif':
    case 'pdf':       return 'warning';
    default:          return 'ghost';
  }
}

function SideRow({ side, role }: { side: CandidateSide; role: 'outflow' | 'inflow' }) {
  const isOutflow = role === 'outflow';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18,
        color: isOutflow ? 'var(--error)' : 'var(--success)',
        minWidth: 110, textAlign: 'right',
      }}>
        {isOutflow ? '−' : '+'}{fmt(Math.abs(side.amount))}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', minWidth: 86 }}>{side.date}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-strong)' }}>{side.accountName}</span>
          <Pill tone={sourcePillTone(side.source)} style={{ fontSize: 9, padding: '1px 6px' }}>{side.source}</Pill>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--fg-subtle)' }}>{side.institution}</span>
          {side.institution && (side.description || side.merchant) ? <span style={{ margin: '0 6px', color: 'var(--fg-subtle)' }}>·</span> : null}
          {side.description || side.merchant || ' - '}
        </div>
      </div>
      <Pill tone={side.tier === 'cc-payment' ? 'success' : 'info'}>
        {side.tier === 'cc-payment' ? 'CC payment' : 'transfer'}
      </Pill>
    </div>
  );
}
