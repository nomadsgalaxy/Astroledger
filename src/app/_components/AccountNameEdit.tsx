'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Inline-edit on the account name. Click name → input; Enter or blur → save;
// Esc → cancel. Empty / whitespace-only names are rejected (revert + error tip).
export default function AccountNameEdit({ accountId, initialName }: {
  accountId: string; initialName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue]   = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  // Keep local state in sync if parent re-renders with a new name post-save
  useEffect(() => { setValue(initialName); }, [initialName]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) { setError('Name required'); setValue(initialName); setEditing(false); return; }
    if (trimmed === initialName) { setEditing(false); return; }
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/accounts/${accountId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error || `Save failed (${r.status})`);
        setValue(initialName);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
      setValue(initialName);
    } finally {
      setSaving(false); setEditing(false);
    }
  }

  if (!editing) {
    return (
      <div
        className="t-row-primary"
        title="Click to rename"
        onClick={() => setEditing(true)}
        style={{ cursor: 'text', borderBottom: '1px dashed transparent', display: 'inline-block', padding: '1px 0' }}
        onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--border-strong)')}
        onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
      >
        {value}
        {error && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--error)' }}>· {error}</span>}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={saving}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); save(); }
        if (e.key === 'Escape') { setValue(initialName); setEditing(false); }
      }}
      style={{
        font: 'inherit', fontWeight: 700, color: 'var(--fg-strong)',
        background: 'var(--bg-elevated)', border: '1px solid var(--accent)',
        borderRadius: 'var(--r-xs)', padding: '2px 6px', outline: 'none',
        width: '100%', maxWidth: 320,
      }}
    />
  );
}
