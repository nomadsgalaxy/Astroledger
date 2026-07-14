'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';

type TagOption = { id: string; name: string; color: string | null; count: number };

const input = {
  width: '100%', height: 36, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
} as const;

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export default function ReportsPicker({ tags }: { tags: TagOption[] }) {
  const router = useRouter();
  const [tag, setTag] = useState(tags[0]?.name ?? '');
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [includeInflows, setIncludeInflows] = useState(false);

  if (tags.length === 0) {
    return (
      <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)', color: 'var(--fg-muted)', fontSize: 13 }}>
        No primary tags yet. Create a primary tag (e.g. <em>Work Travel - Boise May 2026</em>) on any transaction first,
        attach it to your trip expenses, then come back here.
      </div>
    );
  }

  function go(format: 'view' | 'csv') {
    const qs = new URLSearchParams({ tag, from, to, ...(includeInflows ? { include_inflows: '1' } : {}) });
    if (format === 'csv') {
      qs.set('format', 'csv');
      window.location.href = `/api/reports/expense?${qs.toString()}`;
    } else {
      router.push(`/reports/expense?${qs.toString()}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>Parent tag</label>
        <select value={tag} onChange={e => setTag(e.target.value)} style={input}>
          {tags.map(t => (
            <option key={t.id} value={t.name}>
              {t.name} ({t.count})
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} />
        </div>
        <div>
          <label className="t-caption" style={{ display: 'block', marginBottom: 6 }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--fg)', cursor: 'pointer' }}>
        <input type="checkbox" checked={includeInflows} onChange={e => setIncludeInflows(e.target.checked)}
               style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
        Include reimbursements / refunds (positive amounts)
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}>
        <Btn variant="outline" size="md" icon="↓" onClick={() => go('csv')}>CSV</Btn>
        <Btn variant="primary" size="md" icon="→" onClick={() => go('view')}>Generate report</Btn>
      </div>
    </div>
  );
}
