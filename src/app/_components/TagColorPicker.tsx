'use client';
import { useState, useRef, useEffect } from 'react';

// Visual color picker - click a swatch to pick, or use the eyedropper input
// for any custom color. Child tags (parentColor != null) also get an
// "inherit" option that maps to null on save, so the child renders with the
// parent's color throughout the UI.
const PALETTE = ['#FD5000', '#346EF4', '#65C900', '#FFDC00', '#D946EF', '#06B6D4', '#A855F7', '#F97316', '#EC4899', '#3F9C35'];

export default function TagColorPicker({ value, onChange, parentColor }: {
  value: string | null;
  onChange: (next: string | null) => void;   // null = inherit (children) / auto-pick (parents)
  parentColor?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value && !PALETTE.includes(value) ? value : '');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Resolved color to show in the trigger button
  const resolved = value || parentColor || '#7a7a7a';
  const isInherited = !value && !!parentColor;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={isInherited ? `Inherits parent color (${parentColor})` : value ? `Color: ${value}` : 'No color set'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px 3px 4px', height: 28,
          border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
          background: 'var(--bg)', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)',
        }}
      >
        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          background: resolved,
          border: isInherited ? '2px dashed rgba(255,255,255,0.5)' : '1px solid rgba(0,0,0,0.15)',
        }} />
        {isInherited ? <span>inherit</span> : <span>{value ? value.toUpperCase() : 'auto'}</span>}
        <span style={{ fontSize: 8, marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-lg)',
          padding: 10, width: 220,
        }}>
          {parentColor !== undefined && (
            <button type="button"
                    onClick={() => { onChange(null); setCustom(''); setOpen(false); }}
                    style={menuItem(value === null)}>
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                background: parentColor ?? '#7a7a7a',
                border: '2px dashed rgba(255,255,255,0.5)',
              }} />
              <span style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
                {parentColor ? 'Inherit from parent' : 'Auto'}
              </span>
            </button>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: parentColor !== undefined ? 8 : 0 }}>
            {PALETTE.map(c => (
              <button key={c}
                      type="button"
                      onClick={() => { onChange(c); setCustom(''); setOpen(false); }}
                      title={c}
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: c, cursor: 'pointer',
                        border: value === c ? '3px solid var(--fg-strong)' : '1px solid rgba(0,0,0,0.15)',
                        padding: 0,
                      }} />
            ))}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-muted)', cursor: 'pointer' }}>
              <span>Custom:</span>
              <input
                type="color"
                value={custom || resolved}
                onChange={e => { const v = e.target.value; setCustom(v); onChange(v); }}
                style={{ width: 32, height: 22, padding: 0, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
              />
              {custom && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg)' }}>{custom.toUpperCase()}</span>
              )}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function menuItem(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '6px 8px', borderRadius: 'var(--r-xs)',
    background: active ? 'var(--bg-subtle)' : 'transparent',
    border: '1px solid transparent', cursor: 'pointer',
    textAlign: 'left',
  };
}
