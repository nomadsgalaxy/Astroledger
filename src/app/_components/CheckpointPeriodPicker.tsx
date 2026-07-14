'use client';
import { useRouter } from 'next/navigation';

export default function CheckpointPeriodPicker({ current }: { current: 'month' | 'quarter' | 'ytd' }) {
  const router = useRouter();
  const opts: Array<[typeof current, string]> = [['month', 'Month'], ['quarter', 'Quarter'], ['ytd', 'YTD']];
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)' }}>
      {opts.map(([id, label]) => (
        <button key={id} onClick={() => router.push(`/checkpoint?period=${id}`)} style={{
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          padding: '6px 14px', borderRadius: 'var(--r-xs)', border: 0, cursor: 'pointer',
          background: current === id ? 'var(--bg-elevated)' : 'transparent',
          color: current === id ? 'var(--fg-strong)' : 'var(--fg-muted)',
        }}>{label}</button>
      ))}
    </div>
  );
}
