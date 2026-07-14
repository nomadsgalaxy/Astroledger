'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChipBtn } from './atoms';

// Click-to-edit the displayed merchant name on a transaction. The bank's raw
// description (Transaction.rawDescription) is NEVER mutated - it stays as the
// audit trail. Only Transaction.merchant changes.
//
// After saving, if the old merchant value matched other transactions in
// Astroledger, we surface an "Apply to N others" pill that propagates the rename
// to all siblings via /api/merchants/rename.
export default function MerchantNameEdit({ transactionId, initialMerchant, rawDescription, textStyle, propagate = true }: {
  transactionId: string;
  initialMerchant: string;
  rawDescription?: string;          // tooltip-only, shown so user sees what the bank actually called it
  textStyle?: React.CSSProperties;
  propagate?: boolean;              // offer the "Apply to N others?" affordance after save
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialMerchant);
  const [savedMerchant, setSavedMerchant] = useState(initialMerchant);
  const [siblingCount, setSiblingCount] = useState<number | null>(null);
  const [oldMerchant, setOldMerchant] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  useEffect(() => { setValue(initialMerchant); setSavedMerchant(initialMerchant); }, [initialMerchant]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) { setErr('Name required'); setValue(savedMerchant); setEditing(false); return; }
    if (trimmed === savedMerchant) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error || `Save failed (${r.status})`);
        setValue(savedMerchant);
      } else {
        const prev = savedMerchant;
        setSavedMerchant(trimmed); setValue(trimmed);
        // Look up how many other transactions share the old merchant name - 
        // those are the propagation candidates. Cheap aggregate query.
        if (propagate && prev) {
          fetch(`/api/merchants/count?merchant=${encodeURIComponent(prev)}`)
            .then(r => r.ok ? r.json() : null)
            .then(j => {
              const n = j?.count ?? 0;
              if (n > 0) { setSiblingCount(n); setOldMerchant(prev); }
            })
            .catch(() => null);
        }
        router.refresh();
      }
    } finally { setBusy(false); setEditing(false); }
  }

  async function applyToSiblings() {
    if (!oldMerchant) return;
    setBusy(true);
    try {
      const r = await fetch('/api/merchants/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMerchant: oldMerchant, toMerchant: savedMerchant }),
      });
      if (r.ok) { setSiblingCount(null); setOldMerchant(null); router.refresh(); }
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          onClick={e => { e.stopPropagation(); setEditing(true); }}
          title={rawDescription ? `Original from bank: "${rawDescription}". Click to edit display name (raw stays untouched).` : 'Click to edit'}
          style={{
            cursor: 'text',
            borderBottom: '1px dashed transparent',
            padding: '1px 0',
            ...(textStyle ?? {}),
          }}
          onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--border-strong)')}
          onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
        >
          {savedMerchant}
        </span>
        {err && <span style={{ fontSize: 10, color: 'var(--error)' }}>· {err}</span>}
        {siblingCount && siblingCount > 0 && oldMerchant && (
          <ChipBtn
            tone="accent"
            onClick={e => { e.stopPropagation(); applyToSiblings(); }}
            disabled={busy}
            title={`Rename all ${siblingCount} other charges named "${oldMerchant}" to "${savedMerchant}"`}
          >
            {busy ? '…' : `↳ Apply to ${siblingCount} others`}
          </ChipBtn>
        )}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={busy}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); save(); }
        if (e.key === 'Escape') { setValue(savedMerchant); setEditing(false); }
      }}
      onClick={e => e.stopPropagation()}
      style={{
        font: 'inherit',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--r-xs)',
        padding: '2px 6px', outline: 'none',
        minWidth: 120, maxWidth: 320,
        ...(textStyle ?? {}),
      }}
    />
  );
}
