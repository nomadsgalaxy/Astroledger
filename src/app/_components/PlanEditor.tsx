'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fmt } from './atoms';
import { useAutosave, SaveIndicator } from './useAutosave';

type Line = { id: string; scopeKey: string; month: string; amount: number };

export default function PlanEditor({ planId, months, categories, lines }: {
  planId: string; months: string[]; categories: string[]; lines: Line[];
}) {
  const router = useRouter();

  // Local overlay of edits so the UI shows the latest value immediately while
  // autosave fires in the background.
  const [edits, setEdits] = useState<Map<string, number>>(new Map());

  const { state, schedule } = useAutosave<{ id: string; amount: number }[]>(
    async (payload) => {
      const r = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      router.refresh();
    },
    600,
  );

  const grid = useMemo(() => {
    const m = new Map<string, Map<string, Line>>();
    for (const l of lines) {
      if (!m.has(l.scopeKey)) m.set(l.scopeKey, new Map());
      m.get(l.scopeKey)!.set(l.month, l);
    }
    return m;
  }, [lines]);

  // Buffer of unsaved line edits; coalesced into one PATCH per debounce window.
  const pendingRef = useState<{ map: Map<string, number> }>(() => ({ map: new Map() }))[0];

  function setEdit(id: string, value: number) {
    const next = new Map(edits);
    next.set(id, value);
    setEdits(next);
    pendingRef.map.set(id, value);
    schedule([...pendingRef.map.entries()].map(([id, amount]) => ({ id, amount })));
  }

  const monthHeaders = months.map(m => new Date(m).toLocaleString('en-US', { month: 'short', year: '2-digit' }));

  return (
    <div>
      <div style={{
        padding: '10px 18px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)',
      }}>
        <span className="t-caption">Edit any cell - changes save automatically.</span>
        <SaveIndicator state={state} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)' }}>
              <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--bg-subtle)', textAlign: 'left' }}>Category</th>
              {monthHeaders.map((h, i) => <th key={i} style={th}>{h}</th>)}
              <th style={th}>Total</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => {
              const row = grid.get(cat);
              let rowTotal = 0;
              return (
                <tr key={cat} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--bg-elevated)', fontWeight: 600, color: 'var(--fg-strong)', textAlign: 'left' }}>{cat}</td>
                  {months.map(m => {
                    const line = row?.get(m);
                    const value = line ? (edits.get(line.id) ?? line.amount) : 0;
                    rowTotal += value;
                    return (
                      <td key={m} style={td}>
                        {line ? (
                          <input type="number" step="0.01" defaultValue={line.amount}
                                 onChange={e => setEdit(line.id, parseFloat(e.target.value) || 0)}
                                 style={{
                                   width: '100%', padding: '4px 6px',
                                   background: edits.has(line.id) ? 'rgba(253,80,0,0.12)' : 'transparent',
                                   border: '1px solid transparent',
                                   borderRadius: 'var(--r-xs)',
                                   color: 'var(--fg-strong)',
                                   fontFamily: 'var(--font-mono)',
                                   textAlign: 'right',
                                   fontSize: 12,
                                 }} />
                        ) : <span style={{ color: 'var(--fg-subtle)' }}> - </span>}
                      </td>
                    );
                  })}
                  <td style={{ ...td, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-strong)' }}>
                    {fmt(rowTotal, { cents: false })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 10,
  letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
  color: 'var(--fg-muted)', textAlign: 'right', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
