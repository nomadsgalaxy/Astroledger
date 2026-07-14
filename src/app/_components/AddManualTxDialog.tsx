'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';
import AccountPicker, { type AccountOption } from './AccountPicker';
import { COMMON_CURRENCIES } from '@/lib/currencies';

// Back-compat: the existing transactions filter passes `{ id, label }`. The
// new picker prefers structured fields (name/mask/institution); we widen the
// type so callers can pass either shape.
export type Account = { id: string; label: string; name?: string; mask?: string | null; institution?: string };

export default function AddManualTxDialog({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isAnticipated, setIsAnticipated] = useState(true); // default: anticipated mode
  const [ocrPreview, setOcrPreview] = useState<{ amount?: number; merchant?: string; date?: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const sign = fd.get('flow') === 'out' ? -1 : 1;
    const currency = ((fd.get('currency') as string) || 'USD').toUpperCase();
    const body = {
      accountId:       fd.get('accountId') as string,
      date:            new Date(fd.get('date') as string).toISOString(),
      amount:          sign * Math.abs(parseFloat(fd.get('amount') as string)),
      currency,
      merchant:        (fd.get('merchant') as string) || undefined,
      rawDescription:  (fd.get('rawDescription') as string) || undefined,
      notes:           (fd.get('notes') as string) || null,
      isAnticipated,
    };
    if (!body.accountId) { setErr('Pick an account'); setBusy(false); return; }
    if (!body.amount || Number.isNaN(body.amount)) { setErr('Amount required'); setBusy(false); return; }
    const r = await fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { setErr((await r.json()).error || 'Failed'); setBusy(false); return; }
    const created = await r.json() as { transaction: { id: string } };

    // If the user attached a receipt, upload it now (after the tx exists).
    if (receiptFile && created?.transaction?.id) {
      const upload = new FormData();
      upload.append('file', receiptFile);
      upload.append('transactionId', created.transaction.id);
      upload.append('skipOcr', '1'); // we already OCR'd during pre-fill
      const ur = await fetch('/api/receipts/upload', { method: 'POST', body: upload });
      if (!ur.ok) {
        // Don't fail the whole flow - the tx exists, just surface the receipt err.
        setErr(`Tx saved, but receipt upload failed: ${(await ur.json()).error}`);
      }
    }
    setBusy(false); setOpen(false); setReceiptFile(null); setOcrPreview(null); router.refresh();
  }

  // Pre-OCR a receipt the moment the user picks one so we can pre-fill fields.
  async function onReceiptPick(f: File | null) {
    setReceiptFile(f);
    setOcrPreview(null);
    if (!f) return;
    // Send to upload endpoint with no transactionId to get an orphaned OCR pass.
    const upload = new FormData();
    upload.append('file', f);
    const r = await fetch('/api/receipts/upload', { method: 'POST', body: upload });
    if (!r.ok) return;
    const j = await r.json() as { parse: { amount?: number; merchant?: string; date?: string } | null };
    if (j.parse) setOcrPreview(j.parse);
  }

  const input = {
    width: '100%', height: 36, padding: '0 12px',
    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
    background: 'var(--bg-elevated)', color: 'var(--fg)',
    fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
  } as const;
  const labelCss = { display: 'block', marginBottom: 6 } as const;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Btn variant="primary" size="md" icon="+" onClick={() => setOpen(true)}>Add manual</Btn>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'grid', placeItems: 'center',
        }}>
          <form onClick={e => e.stopPropagation()} onSubmit={submit} style={{
            width: 460, maxWidth: '90vw', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            padding: 24, display: 'flex', flexDirection: 'column', gap: 12,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div className="t-caption">New manual transaction</div>
            <div>
              <label className="t-caption" style={labelCss}>Account</label>
              <AccountPicker
                value={accountId}
                onChange={setAccountId}
                options={accounts.map(a => ({
                  id: a.id,
                  name: a.name ?? a.label,
                  mask: a.mask ?? null,
                  institution: a.institution ?? '',
                } satisfies AccountOption))}
              />
              {/* Hidden field so the existing FormData-based submit handler keeps working. */}
              <input type="hidden" name="accountId" value={accountId} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="t-caption" style={labelCss}>Date</label>
                <input name="date" type="date" defaultValue={today} required style={input} />
              </div>
              <div>
                <label className="t-caption" style={labelCss}>Flow</label>
                <select name="flow" defaultValue="out" style={input}>
                  <option value="out">Outflow (−)</option>
                  <option value="in">Inflow (+)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: 10 }}>
              <div>
                <label className="t-caption" style={labelCss}>Amount</label>
                <input name="amount" type="number" step="0.01" min="0" required placeholder="0.00"
                       defaultValue={ocrPreview?.amount?.toFixed(2)} key={`amt-${ocrPreview?.amount ?? ''}`} style={input} />
              </div>
              <div>
                <label className="t-caption" style={labelCss}>Currency</label>
                <select name="currency" defaultValue="USD" style={input}>
                  {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="t-caption" style={labelCss}>Merchant</label>
                <input name="merchant" placeholder="e.g. Patreon"
                       defaultValue={ocrPreview?.merchant} key={`mer-${ocrPreview?.merchant ?? ''}`} style={input} />
              </div>
            </div>
            <div>
              <label className="t-caption" style={labelCss}>Description</label>
              <input name="rawDescription" placeholder="Free-form notes for matching" style={input} />
            </div>
            <div>
              <label className="t-caption" style={labelCss}>Notes (private)</label>
              <textarea name="notes" rows={2} style={{ ...input, height: 'auto', padding: 10, resize: 'vertical' }} />
            </div>
            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--fg)' }}>
                <input type="checkbox" checked={isAnticipated} onChange={e => setIsAnticipated(e.target.checked)}
                       style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--accent)' }} />
                <span>
                  <strong>Anticipated</strong> - I just paid for this in person and the bank hasn't synced it yet.
                  Astroledger will auto-merge the real charge when it lands.
                </span>
              </label>
              <div>
                <label className="t-caption" style={labelCss}>Receipt (optional)</label>
                <input type="file" accept="image/*,application/pdf"
                       onChange={e => onReceiptPick(e.target.files?.[0] ?? null)}
                       style={{ fontSize: 12, color: 'var(--fg-muted)' }} />
                {ocrPreview && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
                    OCR pre-fill: {[
                      ocrPreview.merchant && `merchant=${ocrPreview.merchant}`,
                      ocrPreview.amount != null && `amount=${ocrPreview.amount}`,
                      ocrPreview.date && `date=${ocrPreview.date}`,
                    ].filter(Boolean).join(', ') || '(nothing parsed)'}
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
              A universal UUID will be auto-generated and follow this transaction across edits and exports.
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <Btn variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn>
              <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add transaction'}</Btn>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
