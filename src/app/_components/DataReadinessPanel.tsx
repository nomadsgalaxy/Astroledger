import Link from 'next/link';
import { Card, Pill } from './atoms';
import type { DataReadiness, ReadinessState } from '@/lib/dataReadiness';

const STATE_META: Record<ReadinessState, { mark: string; label: string; tone: 'success' | 'warning' | 'ghost' }> = {
  complete: { mark: '✓', label: 'Ready', tone: 'success' },
  attention: { mark: '!', label: 'Attention', tone: 'warning' },
  next: { mark: '→', label: 'Next', tone: 'ghost' },
};

export default function DataReadinessPanel({ readiness }: { readiness: DataReadiness }) {
  return (
    <Card eyebrow="Getting started" title="Data readiness"
          action={<Pill tone={readiness.score === 100 ? 'success' : readiness.score >= 60 ? 'info' : 'warning'}>{readiness.score}% ready</Pill>}
          padding={0}>
      <div style={{ padding: '16px 22px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ height: 7, background: 'var(--bg-subtle)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${readiness.score}%`, height: '100%', background: readiness.score === 100 ? 'var(--success)' : 'var(--accent)', borderRadius: 99, transition: 'width 220ms ease' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
          {readiness.completedSteps} of {readiness.steps.length} foundations ready. Each step links to the exact place that moves it forward.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', borderTop: '1px solid var(--border)' }}>
        {readiness.steps.map((step, index) => {
          const meta = STATE_META[step.state];
          return (
            <div key={step.key} style={{
              padding: '16px 18px', minHeight: 142,
              borderRight: index < readiness.steps.length - 1 ? '1px solid var(--border)' : undefined,
              borderBottom: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{
                  width: 25, height: 25, borderRadius: 99, display: 'grid', placeItems: 'center',
                  background: step.state === 'complete' ? 'var(--success)' : step.state === 'attention' ? 'var(--warning)' : 'var(--bg-subtle)',
                  color: step.state === 'next' ? 'var(--fg-muted)' : '#fff',
                  fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12,
                }}>{step.state === 'complete' ? meta.mark : step.state === 'attention' ? meta.mark : index + 1}</span>
                <Pill tone={meta.tone} style={{ fontSize: 8 }}>{meta.label}</Pill>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-strong)' }}>{step.title}</div>
              <div style={{ flex: 1, fontSize: 11, lineHeight: 1.5, color: 'var(--fg-muted)' }}>{step.detail}</div>
              <Link href={step.href} style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                {step.action} →
              </Link>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
