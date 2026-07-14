'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { TagOption } from './TagPicker';
import { useAutosave, SaveIndicator } from './useAutosave';
import TagColorPicker from './TagColorPicker';

const PALETTE = ['#FD5000', '#346EF4', '#65C900', '#FFDC00', '#D946EF', '#06B6D4', '#A855F7', '#F97316', '#EC4899', '#3F9C35'];

export default function TagManager({ initialTags }: { initialTags: TagOption[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<TagOption[]>(initialTags);

  async function reload() {
    const r = await fetch('/api/tags');
    const d = await r.json();
    setTags(d.tags ?? []);
    router.refresh();
  }

  async function createParent() {
    const name = prompt('New parent tag name:')?.trim();
    if (!name) return;
    await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind: 'primary', color: PALETTE[tags.filter(t => !t.parentId).length % PALETTE.length] }),
    });
    reload();
  }

  async function createChild(parentId: string) {
    const name = prompt('New child tag name:')?.trim();
    if (!name) return;
    await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind: 'secondary', parentId }),
    });
    reload();
  }

  async function destroy(id: string) {
    if (!confirm('Delete this tag? Attachments to transactions and subscriptions will be removed; child tags become orphans (no parent).')) return;
    await fetch(`/api/tags/${id}`, { method: 'DELETE' });
    reload();
  }

  const parents = tags.filter(t => !t.parentId);
  const childrenOf = (id: string) => tags.filter(t => t.parentId === id);

  return (
    <div id="tags" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {tags.length} tags · {parents.length} parents · {tags.length - parents.length} children
        </div>
        <button onClick={createParent} style={{
          padding: '6px 12px', borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
          color: 'var(--fg-strong)', fontFamily: 'var(--font-product)', fontWeight: 700,
          fontSize: 11, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          cursor: 'pointer',
        }}>+ Parent tag</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {parents.length === 0 && (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No tags yet. Create your first parent tag - e.g. <em>Subscription</em>, <em>Work related</em>, <em>Personal</em>.
          </div>
        )}
        {parents.map(p => (
          <TagRow key={p.id} tag={p} onChange={reload}
                  childTags={childrenOf(p.id)}
                  parentColor={null}
                  onAddChild={() => createChild(p.id)}
                  onDelete={() => destroy(p.id)} />
        ))}
      </div>
    </div>
  );
}

function TagRow({ tag, childTags, parentColor, onChange, onAddChild, onDelete }: {
  tag: TagOption;
  childTags: TagOption[];
  parentColor: string | null;       // null for top-level parent rows
  onChange: () => void;
  onAddChild?: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<string | null>(tag.color ?? null);
  const [kind, setKind] = useState<'primary' | 'secondary'>(tag.kind);
  const { state, schedule } = useAutosave<Record<string, unknown>>(async (patch) => {
    const r = await fetch(`/api/tags/${tag.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    onChange();
  }, 500);

  useEffect(() => { setName(tag.name); setColor(tag.color ?? null); setKind(tag.kind); }, [tag.id, tag.name, tag.color, tag.kind]);

  const isParent = !tag.parentId;
  // Resolved color used for the preview swatch - explicit > inherited > fallback.
  const resolvedColor = color ?? parentColor ?? (kind === 'primary' ? '#346EF4' : '#7a7a7a');
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
      padding: 12, background: isParent ? 'var(--bg-subtle)' : 'var(--bg-elevated)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 130px 120px 24px 90px 90px', gap: 10, alignItems: 'center' }}>
        <span title={!color && parentColor ? `Inherits ${parentColor} from parent` : undefined}
              style={{
                width: 22, height: 22,
                borderRadius: isParent ? 4 : '50%',
                background: resolvedColor,
                border: !color && parentColor ? '2px dashed rgba(255,255,255,0.4)' : '1px solid rgba(0,0,0,0.15)',
              }} />
        <input value={name}
               onChange={e => { setName(e.target.value); schedule({ name: e.target.value }); }}
               style={inputCss} />
        <select value={kind}
                onChange={e => { const v = e.target.value as 'primary' | 'secondary'; setKind(v); schedule({ kind: v }); }}
                style={inputCss}>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
        </select>
        <TagColorPicker
          value={color}
          onChange={next => { setColor(next); schedule({ color: next }); }}
          parentColor={isParent ? undefined : parentColor}
        />
        <SaveIndicator state={state} />
        {isParent && onAddChild && (
          <button onClick={onAddChild} style={smallBtn}>+ child</button>
        )}
        {!isParent && <span />}
        <button onClick={onDelete} style={{ ...smallBtn, color: 'var(--error)' }}>delete</button>
      </div>
      {childTags.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Children inherit the parent's RESOLVED color so a 3rd-level chain still works. */}
          {childTags.map(c => (
            <TagRow key={c.id}
                    tag={c}
                    childTags={[]}
                    parentColor={resolvedColor}
                    onChange={onChange}
                    onDelete={() => onDelete()} />
          ))}
        </div>
      )}
    </div>
  );
}

const inputCss: React.CSSProperties = {
  height: 28, padding: '0 8px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
  background: 'var(--bg)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
};
const smallBtn: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 'var(--r-xs)',
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--fg-muted)', fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', cursor: 'pointer',
};
