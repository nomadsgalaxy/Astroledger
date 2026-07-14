'use client';
import { useState, useMemo, useRef, useEffect, useTransition, CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Pill, MerchantLogo, Btn, ProgressBar, SectionHeader, fmt, fmtDate } from './atoms';
import AutoCategorizeBtn from './AutoCategorizeBtn';
import AutoTagBtn from './AutoTagBtn';
import MerchantNameEdit from './MerchantNameEdit';
import AddManualTxDialog from './AddManualTxDialog';
import HuntDownPanel from './HuntDownPanel';
import { useAutosave, SaveIndicator } from './useAutosave';
import TagPicker, { type TagOption } from './TagPicker';
import { useResizableColumns, ResizableHeaderCell } from './useResizableColumns';

const TX_COLS = [
  { key: 'check',    width: 32,  min: 32,  resizable: false },
  { key: 'date',     width: 100, min: 70 },
  { key: 'merchant', flex: 1,    min: 180 },
  { key: 'tags',     width: 220, min: 120 },
  { key: 'account',  width: 140, min: 90 },
  { key: 'amount',   width: 110, min: 80 },
  { key: 'chev',     width: 24,  min: 24,  resizable: false },
] as const;

type Tx = {
  id: string; uuid: string | null; date: string; amount: number; merchant: string; rawDescription: string;
  category: string; categoryColor: string | null;
  accountId: string; accountName: string; institutionName: string; accountMask: string;
  pending: boolean; isRecurring: boolean; isAnticipated?: boolean; note: string | null;
  tags: TagOption[];
};

type CatMeta = { name: string; color: string | null };

const inputCss: CSSProperties = {
  height: 36, padding: '0 12px 0 32px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
};

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      ...inputCss, width: 'auto', minWidth: 150, padding: '0 28px 0 12px', cursor: 'pointer',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23808285' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
      appearance: 'none', WebkitAppearance: 'none',
    }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange}
           style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
  );
}

export default function TransactionsClient({ transactions, categories, accounts, rangeLabel, dayFilter, reviewFilter }: {
  transactions: Tx[]; categories: CatMeta[]; accounts: Array<{ id: string; label: string }>;
  rangeLabel?: string;
  dayFilter?: string | null;
  reviewFilter?: 'unorganized' | 'anticipated' | 'pending' | null;
}) {
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [acc, setAcc] = useState('all');
  const [sort, setSort] = useState<'date' | 'amount'>('date');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Build a flat list of every tag actually attached to a transaction in view
  // so the filter dropdown is auto-derived (no extra fetch).
  const allTagsInUse = useMemo(() => {
    const map = new Map<string, TagOption>();
    for (const t of transactions) for (const tag of t.tags) if (!map.has(tag.id)) map.set(tag.id, tag);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(t => t.merchant.toLowerCase().includes(q)
        || (t.note ?? '').toLowerCase().includes(q)
        || t.tags.some(tag => tag.name.toLowerCase().includes(q))
        || t.rawDescription.toLowerCase().includes(q));
    }
    if (tagFilter !== 'all') list = list.filter(t => t.tags.some(tag => tag.id === tagFilter));
    if (acc !== 'all') list = list.filter(t => t.accountId === acc);
    if (sort === 'amount') list = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return list;
  }, [transactions, query, tagFilter, acc, sort]);

  const totalIn = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const outflows = filtered.filter(t => t.amount < 0);
  const largest = filtered.length ? Math.max(...filtered.map(t => Math.abs(t.amount))) : 0;

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(t => t.id)));
  };
  const toggleOne = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  async function applyBulkCategory() {
    if (!bulkCategory || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const response = await fetch('/api/transactions/categorize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txIds: [...selected], category: bulkCategory }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Bulk categorization failed');
      setSelected(new Set());
      setBulkCategory('');
      startTransition(() => router.refresh());
    } catch (error) {
      alert('Bulk categorization failed: ' + (error as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    const safe = (value: string | number | boolean) => {
      let text = String(value);
      if (/^[=+@]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = filtered.map(tx => [
      tx.date.slice(0, 10), tx.merchant, tx.rawDescription, tx.amount,
      tx.category, tx.tags.map(tag => tag.parentName ? `${tag.parentName} / ${tag.name}` : tag.name).join(' | '),
      tx.accountName, tx.institutionName, tx.pending, tx.isAnticipated ?? false, tx.note ?? '',
    ]);
    const csv = [
      ['Date', 'Merchant', 'Description', 'Amount', 'Category', 'Tags', 'Account', 'Institution', 'Pending', 'Anticipated', 'Notes'],
      ...rows,
    ].map(row => row.map(safe).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `astroledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${filtered.length} of ${transactions.length} transactions${rangeLabel ? ` · ${rangeLabel}` : ''}`}
        title="Transactions"
        subtitle="Every charge across every account in the selected window. Filter, categorize, or split."
        right={
          <div className="m3-toolbar-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <AutoTagBtn />
            <AutoCategorizeBtn />
            <Btn variant="outline" size="md" icon="↓" onClick={exportCsv}>Export CSV</Btn>
            <AddManualTxDialog accounts={accounts} />
          </div>
        }
      />

      {dayFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 'var(--r-sm)',
          background: 'rgba(253,80,0,0.08)', border: '1px solid rgba(253,80,0,0.35)',
        }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--accent)' }}>
            Filtered to a single day
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-strong)' }}>{dayFilter}</span>
          <div style={{ flex: 1 }} />
          <a href="/transactions" style={{
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)', textDecoration: 'none',
            height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
            border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1,
            boxSizing: 'border-box',
          }}>✕ Clear filter</a>
        </div>
      )}

      {reviewFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 'var(--r-sm)',
          background: 'rgba(253,80,0,0.08)', border: '1px solid rgba(253,80,0,0.35)',
        }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--accent)' }}>
            Review queue
          </span>
          <span style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
            {reviewFilter === 'unorganized' ? 'Spending without a category or tag'
              : reviewFilter === 'anticipated' ? 'Past expected transactions still unmatched'
              : 'Pending transactions older than seven days'}
          </span>
          <div style={{ flex: 1 }} />
          <a href="/transactions" style={{
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            color: 'var(--fg-muted)', textDecoration: 'none',
            height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
            border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center',
          }}>✕ Clear queue</a>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        <Card padding={18}><StatTile label="In (filtered)" value={`+${fmt(totalIn, { cents: false })}`} color="var(--success)" /></Card>
        <Card padding={18}><StatTile label="Out (filtered)" value={fmt(Math.abs(totalOut), { cents: false })} /></Card>
        <Card padding={18}><StatTile label="Avg / transaction" value={fmt(outflows.length ? Math.abs(totalOut) / outflows.length : 0)} /></Card>
        <Card padding={18}><StatTile label="Largest" value={fmt(largest)} /></Card>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-subtle)' }}>⌕</span>
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Search merchant, note, tag…"
                 style={{ ...inputCss, width: '100%' }} />
        </div>
        <Select value={tagFilter} onChange={setTagFilter}
          options={[['all', 'All tags'], ...allTagsInUse.map(t => [t.id, t.parentName ? `${t.parentName} / ${t.name}` : t.name] as [string, string])]} />
        <Select value={acc} onChange={setAcc} options={[['all', 'All accounts'], ...accounts.map(a => [a.id, a.label] as [string, string])]} />
        <Select value={sort} onChange={v => setSort(v as 'date' | 'amount')} options={[['date', 'Sort: Newest'], ['amount', 'Sort: Amount']]} />
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 4px' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{selected.size} selected</span>
            <select value={bulkCategory} onChange={event => setBulkCategory(event.target.value)} style={{
              ...inputCss, height: 30, width: 'auto', minWidth: 150, padding: '0 28px 0 9px',
            }}>
              <option value="">Choose category…</option>
              {categories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}
            </select>
            <Btn variant="primary" size="sm" disabled={bulkBusy || !bulkCategory} onClick={applyBulkCategory}>
              {bulkBusy ? 'Applying…' : 'Apply'}
            </Btn>
            <Btn variant="ghost" size="sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}
      </div>

      <Card padding={0} style={{ overflow: 'hidden' }}>
        <TxTable
          filtered={filtered}
          transactions={transactions}
          selected={selected}
          toggleAll={toggleAll}
          toggleOne={toggleOne}
        />
      </Card>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="t-stat" style={{ lineHeight: 1, marginTop: 6, color: color ?? undefined }}>{value}</div>
    </div>
  );
}

// Hosts the live `--cols` CSS variable. Header + every row read from it via
// `grid-template-columns: var(--cols)`, so one drag updates everything.
function TxTable({ filtered, transactions, selected, toggleAll, toggleOne }: {
  filtered: Tx[]; transactions: Tx[];
  selected: Set<string>;
  toggleAll: () => void;
  toggleOne: (id: string) => void;
}) {
  const { containerRef, cssVars, startDrag, resetBoundary } = useResizableColumns(
    'astroledger-cols-transactions',
    TX_COLS as unknown as Array<{ key: string; width?: number; flex?: number; min?: number; resizable?: boolean }>,
  );
  return (
    <div ref={containerRef} style={cssVars}>
      <div className="m3-tx-header" style={{
        display: 'grid',
        gridTemplateColumns: 'var(--cols)',
        padding: '10px 22px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
        fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
        letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
        color: 'var(--fg-muted)', gap: 12, position: 'relative',
      }}>
        <ResizableHeaderCell index={0} startDrag={startDrag} resetBoundary={resetBoundary}>
          <Checkbox
            checked={selected.size > 0 && selected.size === filtered.length}
            indeterminate={selected.size > 0 && selected.size < filtered.length}
            onChange={toggleAll}
          />
        </ResizableHeaderCell>
        <ResizableHeaderCell index={1} startDrag={startDrag} resetBoundary={resetBoundary}>Date</ResizableHeaderCell>
        <ResizableHeaderCell index={2} startDrag={startDrag} resetBoundary={resetBoundary}>Merchant</ResizableHeaderCell>
        <ResizableHeaderCell index={3} startDrag={startDrag} resetBoundary={resetBoundary}>Tags</ResizableHeaderCell>
        <ResizableHeaderCell index={4} startDrag={startDrag} resetBoundary={resetBoundary}>Account</ResizableHeaderCell>
        <ResizableHeaderCell index={5} startDrag={startDrag} resetBoundary={resetBoundary} align="right">Amount</ResizableHeaderCell>
        <ResizableHeaderCell index={6} startDrag={startDrag} resetBoundary={resetBoundary} last />
      </div>
      <div style={{ maxHeight: 'calc(100vh - 460px)', minHeight: 400, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            {transactions.length === 0 ? 'No transactions yet - import a CSV or connect an account.' : 'No transactions match your filters.'}
          </div>
        ) : filtered.map(tx => (
          <TxRow key={tx.id} tx={tx} selected={selected.has(tx.id)} onToggle={() => toggleOne(tx.id)} />
        ))}
      </div>
    </div>
  );
}

function TxRow({ tx, selected, onToggle }: { tx: Tx; selected: boolean; onToggle: () => void }) {
  const isIncome = tx.amount > 0;
  const router = useRouter();
  const params = useSearchParams();
  function openModal() {
    const next = new URLSearchParams(params.toString());
    next.set('tx', tx.id);
    router.push(`?${next.toString()}`);
  }
  return (
    <>
      <div onClick={openModal} className="m3-tx-row" style={{
        display: 'grid',
        gridTemplateColumns: 'var(--cols)',
        padding: '10px 22px', borderBottom: '1px solid var(--border)',
        gap: 12, alignItems: 'center',
        background: selected ? 'rgba(253,80,0,0.04)' : 'transparent',
        cursor: 'pointer', transition: 'var(--dur-fast)',
      }}>
        <div onClick={e => e.stopPropagation()}><Checkbox checked={selected} onChange={onToggle} /></div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(tx.date)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <MerchantLogo name={tx.merchant} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tx.isAnticipated ? 'var(--fg-muted)' : 'var(--fg-strong)', fontStyle: tx.isAnticipated ? 'italic' : 'normal', whiteSpace: 'nowrap' }}
                 onClick={e => e.stopPropagation()}>
              <MerchantNameEdit transactionId={tx.id} initialMerchant={tx.merchant} rawDescription={tx.rawDescription} />
              {tx.pending && <Pill tone="ghost" style={{ marginLeft: 8, fontSize: 8 }}>Pending</Pill>}
              {tx.isAnticipated && <Pill tone="info" style={{ marginLeft: 8, fontSize: 8 }}>Anticipated</Pill>}
            </div>
            {tx.note && <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.note}</div>}
          </div>
        </div>
        <div onClick={e => e.stopPropagation()}>
          <TagPicker scope="transaction" entityId={tx.id} initial={tx.tags} compact />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.institutionName} <span style={{ fontFamily: 'var(--font-mono)' }}>{tx.accountMask}</span>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
          color: isIncome ? 'var(--success)' : 'var(--fg-strong)' }}>
          {tx.isRecurring && <Pill tone="info" style={{ fontSize: 8, padding: '1px 5px' }}>↻</Pill>}
          <span>{isIncome ? '+' : '−'}{fmt(Math.abs(tx.amount))}</span>
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 10 }}>›</span>
      </div>
    </>
  );
}

function TxDetail({ tx }: { tx: Tx }) {
  const [note, setNote] = useState(tx.note ?? '');
  const { state, schedule } = useAutosave<{ notes: string | null }>(async (patch) => {
    const r = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
  }, 700);

  return (
    <div style={{ padding: '18px 22px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24 }}>
        <div>
          <div className="t-caption" style={{ marginBottom: 6 }}>Details</div>
          <div style={{ fontSize: 14, color: 'var(--fg-strong)', marginBottom: 4 }}><strong>{tx.merchant}</strong></div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
            Posted {new Date(tx.date).toDateString()} · {tx.institutionName} {tx.accountMask}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            Raw: {tx.rawDescription}
          </div>
          {tx.uuid && (
            <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginBottom: 12, fontFamily: 'var(--font-mono)' }} title="Universal ID - stable across edits, imports, and device sync">
              UUID: {tx.uuid}
            </div>
          )}
          <div className="t-caption" style={{ marginBottom: 8 }}>Tags</div>
          <div style={{ marginBottom: 14 }}>
            <TagPicker scope="transaction" entityId={tx.id} initial={tx.tags} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <HuntDownPanel txId={tx.id} rawDescription={tx.rawDescription} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div className="t-caption">Note</div>
            <SaveIndicator state={state} />
          </div>
          <textarea
            value={note}
            onChange={e => { setNote(e.target.value); schedule({ notes: e.target.value || null }); }}
            placeholder="Add a note - saved automatically"
            rows={2}
            style={{
              width: '100%', padding: 10,
              border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              background: 'var(--bg-elevated)', color: 'var(--fg)',
              fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>
        <div>
          <div className="t-caption" style={{ marginBottom: 8 }}>Classification</div>
          <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
            <div>{tx.tags.length === 0 ? <span style={{ color: 'var(--fg-muted)' }}>No tags yet - pick some above.</span> : <span><strong style={{ color: 'var(--fg-strong)' }}>{tx.tags.length}</strong> tag{tx.tags.length === 1 ? '' : 's'} assigned.</span>}</div>
            {tx.category && tx.category !== 'Other' && (
              <div style={{ marginTop: 4, color: 'var(--fg-subtle)', fontSize: 11 }}>Legacy category: {tx.category}</div>
            )}
            {tx.isRecurring && <div style={{ marginTop: 4, color: 'var(--accent)' }}>Linked to subscription</div>}
          </div>
        </div>
        <div>
          <div className="t-caption" style={{ marginBottom: 8 }}>Account</div>
          <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
            <div>{tx.institutionName}</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{tx.accountName} {tx.accountMask}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
