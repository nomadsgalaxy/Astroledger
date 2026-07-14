import type { ReactNode } from 'react';

export default function ConnectSourceGroup({
  id, eyebrow, title, description, children, open = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details id={id} open={open} style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--bg-panel)', scrollMarginTop: 90, overflow: 'hidden',
    }}>
      <summary style={{
        cursor: 'pointer', padding: '17px 20px', listStylePosition: 'inside',
        borderBottom: '1px solid var(--border)', userSelect: 'none',
      }}>
        <span className="t-caption" style={{ marginLeft: 8 }}>{eyebrow}</span>
        <span style={{ display: 'block', margin: '5px 0 0 25px', fontSize: 17, fontWeight: 750, color: 'var(--fg-strong)' }}>{title}</span>
        <span style={{ display: 'block', margin: '5px 0 0 25px', maxWidth: 850, fontSize: 12, lineHeight: 1.5, color: 'var(--fg-muted)' }}>{description}</span>
      </summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 18, padding: 18 }}>
        {children}
      </div>
    </details>
  );
}
