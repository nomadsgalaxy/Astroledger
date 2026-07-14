import Link from 'next/link';
import { Card, Pill } from './atoms';
import type { FinancialInboxItem } from '@/lib/dataReadiness';

export default function FinancialInboxCard({ items }: { items: FinancialInboxItem[] }) {
  const urgent = items.filter(item => item.tone === 'error').length;
  return (
    <Card eyebrow="Financial inbox" title="What needs attention" padding={0}
          action={<Pill tone={urgent > 0 ? 'error' : items.length > 0 ? 'warning' : 'success'}>
            {items.length > 0 ? `${items.length} queue${items.length === 1 ? '' : 's'}` : 'All clear'}
          </Pill>}>
      {items.length === 0 ? (
        <div style={{ padding: 26, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)' }}>Nothing is waiting on you</div>
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--fg-muted)' }}>Connections are current and the core review queues are clear.</div>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {items.map(item => (
            <div key={item.key} style={{
              display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              gap: 14, alignItems: 'center', padding: '14px 22px', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                minWidth: 34, height: 34, padding: '0 8px', borderRadius: 'var(--r-sm)',
                display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800,
                background: item.tone === 'error' ? 'rgba(213, 50, 50, 0.12)' : item.tone === 'warning' ? 'rgba(237, 151, 0, 0.12)' : 'var(--bg-subtle)',
                color: item.tone === 'error' ? 'var(--error)' : item.tone === 'warning' ? 'var(--warning)' : 'var(--accent)',
              }}>{item.count.toLocaleString()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-strong)' }}>{item.title}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.45 }}>{item.detail}</div>
              </div>
              <Link href={item.href} style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {item.action} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
