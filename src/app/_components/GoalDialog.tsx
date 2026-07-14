'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from './atoms';
import { useAutosave, SaveIndicator } from './useAutosave';

type Goal = {
  id?: string;
  name?: string;
  kind?: string;
  targetAmount?: number;
  currentAmount?: number;
  deadline?: string | Date | null;
  notes?: string | null;
};

export default function GoalDialog({ goal, mode = 'create', label = 'New goal' }: {
  goal?: Goal; mode?: 'create' | 'edit'; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Edit mode: per-field autosave
  const editingId = mode === 'edit' ? goal?.id ?? null : null;
  const { state, schedule } = useAutosave<Partial<Goal>>(async (patch) => {
    if (!editingId) return;
    const r = await fetch(`/api/goals/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
    router.refresh();
  }, 600);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode !== 'create') { setOpen(false); return; }
    setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get('name'),
      kind: fd.get('kind'),
      targetAmount: fd.get('targetAmount'),
      currentAmount: fd.get('currentAmount'),
      deadline: fd.get('deadline') || null,
      notes: fd.get('notes') || null,
    };
    const r = await fetch('/api/goals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { setErr((await r.json()).error || 'Failed'); setBusy(false); return; }
    setBusy(false); setOpen(false); router.refresh();
  }

  async function destroy() {
    if (!goal?.id) return;
    if (!confirm('Delete this goal?')) return;
    setBusy(true);
    await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
    setBusy(false); setOpen(false); router.refresh();
  }

  const input = {
    width: '100%', height: 36, padding: '0 12px',
    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
    background: 'var(--bg-elevated)', color: 'var(--fg)',
    fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
  } as const;
  const labelCss = { display: 'block', marginBottom: 6 } as const;

  // Helper: bind a field for either create (defaultValue, FormData) or edit (autosave)
  const editProps = (field: keyof Goal, kind: 'string' | 'number' | 'date' = 'string') => {
    if (mode !== 'edit') return {};
    return {
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const v = e.target.value;
        schedule({ [field]: kind === 'number' ? Number(v) : kind === 'date' ? (v || null) : (v || null) } as Partial<Goal>);
      },
    };
  };

  return (
    <>
      <Btn variant={mode === 'create' ? 'primary' : 'outline'} size={mode === 'create' ? 'md' : 'sm'} onClick={() => setOpen(true)}>
        {label}
      </Btn>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'grid', placeItems: 'center',
        }}>
          <form onClick={e => e.stopPropagation()} onSubmit={submit} style={{
            width: 460, maxWidth: '90vw', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            padding: 24, display: 'flex', flexDirection: 'column', gap: 12,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="t-caption">{mode === 'create' ? 'New goal' : 'Edit goal'}</div>
              {mode === 'edit' && <SaveIndicator state={state} />}
            </div>
            <div>
              <label className="t-caption" style={labelCss}>Name</label>
              <input name="name" required defaultValue={goal?.name ?? ''} placeholder="Emergency fund" style={input}
                onChange={mode === 'edit' ? e => schedule({ name: e.target.value }) : undefined} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="t-caption" style={labelCss}>Kind</label>
                <select name="kind" defaultValue={goal?.kind ?? 'savings'} style={input}
                  onChange={mode === 'edit' ? e => schedule({ kind: e.target.value }) : undefined}>
                  <option value="savings">Savings</option>
                  <option value="debt_payoff">Debt payoff</option>
                  <option value="spend_under">Spending cap</option>
                </select>
              </div>
              <div>
                <label className="t-caption" style={labelCss}>Deadline (optional)</label>
                <input type="date" name="deadline" defaultValue={goal?.deadline ? new Date(goal.deadline).toISOString().slice(0, 10) : ''} style={input}
                  {...editProps('deadline', 'date')} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="t-caption" style={labelCss}>Target amount</label>
                <input name="targetAmount" type="number" step="0.01" required defaultValue={goal?.targetAmount ?? ''} placeholder="5000" style={input}
                  {...editProps('targetAmount', 'number')} />
              </div>
              <div>
                <label className="t-caption" style={labelCss}>Current</label>
                <input name="currentAmount" type="number" step="0.01" defaultValue={goal?.currentAmount ?? 0} style={input}
                  {...editProps('currentAmount', 'number')} />
              </div>
            </div>
            <div>
              <label className="t-caption" style={labelCss}>Notes</label>
              <textarea name="notes" rows={2} defaultValue={goal?.notes ?? ''} style={{ ...input, height: 'auto', padding: 10, resize: 'vertical' }}
                onChange={mode === 'edit' ? e => schedule({ notes: e.target.value }) : undefined} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--error)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              {mode === 'edit' && <Btn variant="danger" size="sm" onClick={destroy} disabled={busy}>Delete</Btn>}
              <div style={{ flex: 1 }} />
              {mode === 'create' ? (
                <>
                  <Btn variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn>
                  <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Btn>
                </>
              ) : (
                <Btn variant="primary" onClick={() => setOpen(false)}>Done</Btn>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
