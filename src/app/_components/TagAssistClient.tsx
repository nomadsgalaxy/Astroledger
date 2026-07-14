'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pill, fmt, fmtDate } from './atoms';
import { tagColor, type TagOption } from './TagPicker';
import MerchantNameEdit from './MerchantNameEdit';

type Row = {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  rawDescription: string;
  account: string;
  accountMask: string | null;
  institution: string;
  subscription: { id: string; merchant: string; cadence: string; amount: number } | null;
  orders: Array<{ id: string; source: string; date: string; amount: number; items: string | null; url: string | null }>;
  merchantSiblings: { count: number; sum: number } | null;
  suggestedTagNames: string[];
};

export default function TagAssistClient({ rows, tags: initialTags }: { rows: Row[]; tags: TagOption[] }) {
  // Lift tag state so newly-created tags appear in every card immediately
  // without a full page refresh.
  const [tags, setTags] = useState<TagOption[]>(initialTags);

  async function createTag(name: string, opts: { kind?: 'primary' | 'secondary'; parentId?: string | null } = {}): Promise<TagOption | null> {
    const r = await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        kind: opts.kind ?? 'primary',
        parentId: opts.parentId ?? null,
      }),
    });
    if (!r.ok) return null;
    const { tag } = await r.json() as { tag: { id: string; name: string; color: string | null; kind: string; parentId: string | null } };
    const next: TagOption = {
      id: tag.id, name: tag.name, color: tag.color,
      kind: (tag.kind === 'primary' ? 'primary' : 'secondary'),
      parentId: tag.parentId,
      parentName: null, parentColor: null,
    };
    setTags(prev => [...prev, next].sort((a, b) => a.name.localeCompare(b.name)));
    return next;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map(r => <AssistCard key={r.id} row={r} tags={tags} onCreateTag={createTag} />)}
    </div>
  );
}

function AssistCard({ row, tags, onCreateTag }: {
  row: Row;
  tags: TagOption[];
  onCreateTag: (name: string, opts?: { kind?: 'primary' | 'secondary'; parentId?: string | null }) => Promise<TagOption | null>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isIncome = row.amount > 0;

  const suggested = row.suggestedTagNames
    .map(name => tags.find(t => t.name === name))
    .filter((t): t is TagOption => !!t);

  async function attach(tagIds: string[]) {
    if (tagIds.length === 0) return;
    setBusy(true);
    try {
      // The /tags endpoint takes { add, remove?, propagate? }. We pass
      // propagate:true (the default) so attaching a tag here also cascades
      // to every other transaction with the same merchant - much faster
      // tag-once-tag-all workflow.
      await fetch(`/api/transactions/${row.id}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add: tagIds, propagate: true }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Copy a ready-made MCP prompt to clipboard so the user can paste into an
  // external agent (Claude / Gemini / ChatGPT) for deep research.
  function copyResearchPrompt() {
    const lines = [
      `Use the astroledger MCP to tag this transaction:`,
      `  transaction_id = "${row.id}"`,
      ``,
      `Steps:`,
      `  1. Call transaction_intel("${row.id}") - full context (account, merchant history, linked subscription, email receipts).`,
      row.merchant ? `  2. Call merchant_intel("${row.merchant}") - broader merchant pattern + suggested tags.` : '',
      row.subscription ? `  ${row.merchant ? 3 : 2}. Call subscription_intel("${row.subscription.id}") - sub cadence + sibling charges.` : '',
      `  Then call attach_tags({ transaction_id, tag_names: [...] }) with your reasoning.`,
      ``,
      `Available primary tags: ${tags.filter(t => t.kind === 'primary').map(t => t.name).join(', ')}`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).catch(() => {});
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--bg-elevated)', overflow: 'hidden',
    }}>
      {/* Header: the transaction itself. Whole header is a link to the modal
          so clicking anywhere (except the MerchantNameEdit which stops the
          click) opens full context. */}
      <Link href={`?tx=${row.id}`} style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <MerchantNameEdit
              transactionId={row.id}
              initialMerchant={row.merchant || row.rawDescription.slice(0, 40)}
              rawDescription={row.rawDescription}
              textStyle={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)' }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{row.date}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {row.rawDescription} <span style={{ color: 'var(--fg-subtle)' }}>·</span> {row.account}{row.accountMask ? ` (${row.accountMask})` : ''} <span style={{ color: 'var(--fg-subtle)' }}>·</span> {row.institution}
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 20, color: isIncome ? 'var(--success)' : 'var(--fg-strong)', textAlign: 'right' }}>
          {isIncome ? '+' : '−'}{fmt(Math.abs(row.amount))}
        </div>
      </Link>

      {/* Context strip */}
      <div style={{ padding: '12px 18px', display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12, color: 'var(--fg)', borderBottom: '1px solid var(--border)' }}>
        {row.merchantSiblings && row.merchantSiblings.count > 0 && (
          <ContextChip label="Other charges from this merchant"
                       value={`${row.merchantSiblings.count} · ${fmt(Math.abs(row.merchantSiblings.sum))}`} />
        )}
        {row.subscription && (
          <ContextChip label="Linked subscription"
                       value={`${row.subscription.merchant} · ${row.subscription.cadence} · ${fmt(row.subscription.amount)}`} />
        )}
        {row.orders.length > 0 && (
          <ContextChip label={`${row.orders.length} email receipt${row.orders.length === 1 ? '' : 's'}`}
                       value={row.orders[0].items ? row.orders[0].items.slice(0, 80) : row.orders[0].source} />
        )}
        {!row.merchantSiblings?.count && !row.subscription && row.orders.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
            No prior context - this merchant or amount is new to Astroledger.
          </div>
        )}
      </div>

      {/* Suggested tags */}
      {suggested.length > 0 && (
        <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
            Suggested
          </span>
          {suggested.map(t => (
            <button key={t.id}
                    onClick={() => attach([t.id])}
                    disabled={busy}
                    style={tagChipBtn(t)}>
              + {t.parentName ? `${t.parentName} / ${t.name}` : t.name}
            </button>
          ))}
        </div>
      )}

      {/* All-tags multi-select + actions */}
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TagSearchAndPicker
          tags={tags}
          selected={selected}
          onToggle={tagId => setSelected(s => {
            const next = new Set(s);
            if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
            return next;
          })}
          onCreate={async name => {
            const t = await onCreateTag(name);
            if (t) setSelected(s => new Set(s).add(t.id));
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={copyResearchPrompt} disabled={busy}
                  title="Copy a prompt to your clipboard for handing off to Claude / Gemini / ChatGPT via the Astroledger MCP server."
                  style={ghostBtn}>
            ⎘ Copy MCP research prompt
          </button>
          <div style={{ flex: 1 }} />
          <Link href={`/transactions?date=${row.date}`} style={ghostBtn}>
            See full day →
          </Link>
          <button onClick={() => attach(Array.from(selected))}
                  disabled={busy || selected.size === 0}
                  style={primaryBtn(busy || selected.size === 0)}>
            {busy ? 'Tagging…' : `✓ Attach ${selected.size || ''} tag${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagSearchAndPicker({ tags, selected, onToggle, onCreate }: {
  tags: TagOption[];
  selected: Set<string>;
  onToggle: (tagId: string) => void;
  onCreate: (name: string, opts?: { kind?: 'primary' | 'secondary'; parentId?: string | null }) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  // Auto-expand any parent that has a selected child OR that the user clicked
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const t of tags) if (t.parentId && selected.has(t.id)) s.add(t.parentId);
    return s;
  });

  // Group: primary tags (no parentId, kind === 'primary') become parents;
  // children attach by parentId. Orphans (secondary with no parent OR primary
  // that someone made a child of) fall into a special "Other" bucket.
  const { parents, childrenByParent, orphans } = useMemo(() => {
    const parents = tags.filter(t => !t.parentId).sort((a, b) => a.name.localeCompare(b.name));
    const parentIds = new Set(parents.map(p => p.id));
    const childrenByParent = new Map<string, TagOption[]>();
    const orphans: TagOption[] = [];
    for (const t of tags) {
      if (!t.parentId) continue;
      if (parentIds.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      } else {
        orphans.push(t);
      }
    }
    for (const [, arr] of childrenByParent) arr.sort((a, b) => a.name.localeCompare(b.name));
    return { parents, childrenByParent, orphans };
  }, [tags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null; // null = render hierarchical
    return tags.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.parentName ?? '').toLowerCase().includes(q)
    );
  }, [query, tags]);

  const trimmed = query.trim();
  const exactExists = trimmed.length > 0 && tags.some(t => t.name.toLowerCase() === trimmed.toLowerCase());
  const showCreate = trimmed.length > 0 && !exactExists;

  async function handleCreate(kind: 'primary' | 'secondary' = 'primary', parentId: string | null = null) {
    if (!trimmed) return;
    setCreating(true);
    try {
      await onCreate(trimmed, { kind, parentId });
      setQuery('');
    } finally { setCreating(false); }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered && filtered.length === 1) onToggle(filtered[0].id);
      else if (showCreate) handleCreate();
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  function toggleParent(parent: TagOption) {
    // Clicking a parent selects it AND expands its children. Click again to
    // unselect; expansion stays open so the user can review children.
    onToggle(parent.id);
    setExpandedParents(prev => {
      const next = new Set(prev);
      next.add(parent.id);
      return next;
    });
  }

  function collapseParent(parentId: string) {
    setExpandedParents(prev => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Search ${tags.length} tags - or type a new name to create…`}
          style={{
            flex: 1, height: 30, padding: '0 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg)', color: 'var(--fg)',
            fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
          }}
        />
        {showCreate && (
          <button onClick={() => handleCreate()} disabled={creating}
                  style={createBtnStyle}>
            {creating ? 'Creating…' : `+ Create "${trimmed}"`}
          </button>
        )}
      </div>

      {/* Searched view: flat filtered list */}
      {filtered !== null && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 28 }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '4px 0' }}>
              No matches. Press <kbd style={kbd}>Enter</kbd> or click <strong>Create "{trimmed}"</strong> above.
            </div>
          ) : filtered.map(t => {
            const active = selected.has(t.id);
            return (
              <button key={t.id}
                      onClick={() => onToggle(t.id)}
                      style={{ ...tagChipBtn(t), outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: active ? 1 : 0 }}>
                {t.parentName ? `${t.parentName} / ${t.name}` : t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Default view: hierarchical, parent first then expanded children */}
      {filtered === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {parents.map(p => {
              const childCount = childrenByParent.get(p.id)?.length ?? 0;
              const expanded = expandedParents.has(p.id);
              const active = selected.has(p.id);
              return (
                <button key={p.id} onClick={() => toggleParent(p)}
                        title={childCount > 0 ? `${childCount} child tag${childCount === 1 ? '' : 's'} - click to expand` : 'No child tags'}
                        style={{ ...tagChipBtn(p), outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: active ? 1 : 0, position: 'relative' }}>
                  {p.name}
                  {childCount > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
                      {expanded ? '▾' : `▸${childCount}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Expanded children rows: one section per expanded parent */}
          {[...expandedParents]
            .filter(pid => (childrenByParent.get(pid)?.length ?? 0) > 0 || true) // always render so user can add children
            .map(pid => {
              const parent = parents.find(p => p.id === pid);
              if (!parent) return null;
              const children = childrenByParent.get(pid) ?? [];
              return (
                <div key={pid}
                     style={{
                       paddingLeft: 12, paddingTop: 6,
                       borderLeft: `2px solid ${tagColor(parent)}`,
                       display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
                     }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
                    {parent.name} →
                  </span>
                  {children.map(c => {
                    const active = selected.has(c.id);
                    return (
                      <button key={c.id} onClick={() => onToggle(c.id)}
                              style={{ ...tagChipBtn(c), outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: active ? 1 : 0 }}>
                        {c.name}
                      </button>
                    );
                  })}
                  {trimmed && !exactExists && (
                    <button onClick={() => handleCreate('secondary', parent.id)}
                            disabled={creating}
                            style={addChildBtnStyle}>
                      + Add "{trimmed}" under {parent.name}
                    </button>
                  )}
                  <button onClick={() => collapseParent(pid)} style={collapseBtnStyle} title="Collapse">×</button>
                </div>
              );
            })}

          {orphans.length > 0 && (
            <div style={{ paddingLeft: 12, borderLeft: '2px dashed var(--border)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
                Other →
              </span>
              {orphans.map(t => {
                const active = selected.has(t.id);
                return (
                  <button key={t.id} onClick={() => onToggle(t.id)}
                          style={{ ...tagChipBtn(t), outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: active ? 1 : 0 }}>
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const createBtnStyle: React.CSSProperties = {
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  padding: '6px 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--accent)', background: 'rgba(253,80,0,0.1)',
  color: 'var(--accent)', cursor: 'pointer',
};
const addChildBtnStyle: React.CSSProperties = {
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 9,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  padding: '3px 8px', borderRadius: 'var(--r-xs)',
  border: '1px dashed var(--accent)', background: 'transparent',
  color: 'var(--accent)', cursor: 'pointer',
};
const collapseBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  width: 18, height: 18, borderRadius: '50%',
  border: 0, background: 'transparent',
  color: 'var(--fg-subtle)', cursor: 'pointer',
  fontSize: 14, lineHeight: 1,
};

const kbd: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10,
  padding: '1px 5px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'var(--bg-panel)',
};

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{value}</span>
    </div>
  );
}

function tagChipBtn(t: TagOption): React.CSSProperties {
  const c = tagColor(t);
  const isPrimary = t.kind === 'primary';
  return {
    padding: '4px 10px', borderRadius: 'var(--r-pill)',
    border: `1px solid ${c}`,
    background: isPrimary ? c : 'transparent',
    color: isPrimary ? '#fff' : c,
    fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font-body)',
    cursor: 'pointer',
  };
}

const ghostBtn: React.CSSProperties = {
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--fg-muted)', cursor: 'pointer', textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 5, lineHeight: 1, boxSizing: 'border-box',
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
    letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
    padding: '8px 14px', borderRadius: 'var(--r-sm)',
    border: 0, background: disabled ? 'var(--bg-panel)' : 'var(--accent)',
    color: disabled ? 'var(--fg-muted)' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
