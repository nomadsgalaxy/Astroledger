'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DropdownPortal from './DropdownPortal';

export type TagOption = {
  id: string;
  name: string;
  color: string | null;
  kind: 'primary' | 'secondary';
  parentId: string | null;
  parentName?: string | null;
  // Color inherited from the parent tag when this tag's `color` is null.
  // Server populates this when the tag has a parent; clients can use it
  // (or tagColor() does it automatically) without re-querying.
  parentColor?: string | null;
};

const DEFAULT_PRIMARY = '#346EF4';
const DEFAULT_SECONDARY = '#7a7a7a';

/**
 * Resolve the display color for a tag:
 *   explicit own color → parent's color (if any) → kind-based default.
 */
export function tagColor(t: { color?: string | null; kind: 'primary' | 'secondary'; parentColor?: string | null }) {
  return t.color || t.parentColor || (t.kind === 'primary' ? DEFAULT_PRIMARY : DEFAULT_SECONDARY);
}

function pathLabel(t: TagOption, all: TagOption[]) {
  if (t.parentName) return `${t.parentName} / ${t.name}`;
  const parent = t.parentId ? all.find(x => x.id === t.parentId) : null;
  return parent ? `${parent.name} / ${t.name}` : t.name;
}

/**
 * Inline tag chips + search popover. Owns its own URL fetches so it can be
 * dropped into any row without prop-drilling tags from the server.
 *
 * @param scope    'transaction' | 'subscription' - used to pick the right API path.
 * @param entityId The tx or sub id.
 * @param initial  Tags currently attached (server-rendered).
 */
export default function TagPicker({ scope, entityId, initial, compact = false }: {
  scope: 'transaction' | 'subscription';
  entityId: string;
  initial: TagOption[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [attached, setAttached] = useState<TagOption[]>(initial);
  const [all, setAll] = useState<TagOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Lazy-load full tag list when the popover opens for the first time.
  useEffect(() => {
    if (!open || all !== null) return;
    fetch('/api/tags').then(r => r.json()).then(d => setAll(d.tags ?? []));
  }, [open, all]);

  const url = scope === 'transaction'
    ? `/api/transactions/${entityId}/tags`
    : `/api/subscriptions/${entityId}/tags`;

  async function toggle(tag: TagOption) {
    const isAttached = attached.some(t => t.id === tag.id);
    const nextAttached = isAttached
      ? attached.filter(t => t.id !== tag.id)
      : [...attached, tag];
    setAttached(nextAttached);
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isAttached ? { remove: [tag.id] } : { add: [tag.id] }),
      });
      if (!r.ok) throw new Error(await r.text());
      startTransition(() => router.refresh());
    } catch (err) {
      setAttached(attached); // rollback
      console.error('toggle tag failed', err);
    }
  }

  const sortedAttached = [...attached].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'primary' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = all?.filter(t => {
    if (!query) return true;
    const q = query.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.parentName ?? '').toLowerCase().includes(q);
  }) ?? [];

  // Group filtered by parent: orphan top-level then children under their parent
  const parents = (all ?? []).filter(t => t.parentId === null);
  const visibleByParent = new Map<string | null, TagOption[]>();
  for (const t of filtered) {
    const k = t.parentId ?? null;
    if (!visibleByParent.has(k)) visibleByParent.set(k, []);
    visibleByParent.get(k)!.push(t);
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {sortedAttached.map(t => (
        <TagChip key={t.id} tag={t} all={all ?? initial} onRemove={() => toggle(t)} compact={compact} />
      ))}
      <button ref={triggerRef} onClick={() => setOpen(o => !o)} style={{
        // Min 28px tall on every viewport. NN/g coarse-pointer target is
        // 44px ideal / 24px floor - chips live inline and 28 is the sweet
        // spot for desktop density + mobile tap reliability.
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        minHeight: 28, padding: '4px 10px', borderRadius: 'var(--r-xs)',
        border: '1px dashed var(--border-strong)', background: 'transparent',
        color: 'var(--fg-muted)', fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700,
        letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', cursor: 'pointer',
        opacity: 0.7, lineHeight: 1, boxSizing: 'border-box',
      }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}>
        + tag
      </button>
      <DropdownPortal triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} width={280} maxHeight={360}>
          <input
            value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Search tags…"
            style={{
              width: '100%', height: 30, padding: '0 10px',
              border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
              background: 'var(--bg-subtle)', color: 'var(--fg)',
              fontSize: 12, outline: 'none', marginBottom: 6,
            }} />
          {all === null && <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>Loading…</div>}
          {all !== null && filtered.length === 0 && (
            <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center' }}>
              No tags match. Edit tags in <a href="/settings#tags" style={{ color: 'var(--accent)' }}>Settings</a>.
            </div>
          )}
          {all !== null && parents.map(p => {
            const childrenVisible = visibleByParent.get(p.id) ?? [];
            const parentVisible = visibleByParent.get(null)?.some(x => x.id === p.id);
            if (!parentVisible && childrenVisible.length === 0) return null;
            return (
              <div key={p.id} style={{ marginTop: 4 }}>
                {parentVisible && <TagOptionRow tag={p} attached={attached.some(t => t.id === p.id)} onClick={() => toggle(p)} />}
                {childrenVisible.map(c => (
                  <div key={c.id} style={{ marginLeft: 12 }}>
                    <TagOptionRow tag={c} attached={attached.some(t => t.id === c.id)} onClick={() => toggle(c)} />
                  </div>
                ))}
              </div>
            );
          })}
          {/* Orphan tags (parent was deleted) */}
          {all !== null && (visibleByParent.get(null) ?? []).filter(t => !parents.some(p => p.id === t.id)).map(t => (
            <TagOptionRow key={t.id} tag={t} attached={attached.some(x => x.id === t.id)} onClick={() => toggle(t)} />
          ))}
      </DropdownPortal>
    </div>
  );
}

function TagChip({ tag, all, onRemove, compact }: { tag: TagOption; all: TagOption[]; onRemove: () => void; compact: boolean }) {
  const color = tagColor(tag);
  const label = compact ? tag.name : pathLabel(tag, all);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: tag.kind === 'primary' ? '2px 8px' : '2px 6px',
      borderRadius: 'var(--r-pill)',
      background: tag.kind === 'primary' ? color : 'transparent',
      border: tag.kind === 'primary' ? 'none' : `1px solid ${color}`,
      color: tag.kind === 'primary' ? '#fff' : color,
      fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-product)',
      letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
    }}>
      {label}
      <button onClick={onRemove} title="Remove" style={{
        // Bumped from ~11×11 to 24×24 so it clears the touch-target floor.
        // Inline-flex + fixed min sizes keep the chip layout tight; the wider
        // hit area is invisible (transparent bg, no border).
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 24, minHeight: 24, padding: '2px 4px',
        background: 'transparent', border: 0, color: 'inherit',
        cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: 0.7, lineHeight: 1,
        marginRight: -2,
      }}>×</button>
    </span>
  );
}

function TagOptionRow({ tag, attached, onClick }: { tag: TagOption; attached: boolean; onClick: () => void }) {
  const color = tagColor(tag);
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      padding: '6px 8px', borderRadius: 'var(--r-xs)', border: 'none',
      background: attached ? 'var(--bg-subtle)' : 'transparent', cursor: 'pointer',
      color: 'var(--fg)', textAlign: 'left',
    }}
      onMouseEnter={e => { if (!attached) e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={e => { if (!attached) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 8, height: 8, borderRadius: tag.kind === 'primary' ? 2 : '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: attached ? 600 : 400, color: attached ? 'var(--accent)' : 'var(--fg)' }}>{tag.name}</span>
      {tag.kind === 'primary' && <span style={{ fontSize: 8, color: 'var(--fg-subtle)', fontFamily: 'var(--font-product)', letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', fontWeight: 700 }}>PRIMARY</span>}
      {attached && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 10 }}>✓</span>}
    </button>
  );
}
