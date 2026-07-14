'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Pill } from './atoms';
import type { TagOption } from './TagPicker';

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  matchType: string;
  matchField: string;
  matchValue: string;
  caseInsensitive: boolean;
  applyTagIds: string | null;
  applyCategory: string | null;
  applyIsTransfer: boolean | null;
  applyMerchant: string | null;
  sortOrder: number;
};

export default function RulesManager({ tags }: { tags: TagOption[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function reload() {
    const r = await fetch('/api/rules');
    if (r.ok) setRules((await r.json()).rules);
  }
  useEffect(() => { reload(); }, []);

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return;
    setBusy(true);
    try {
      await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      await reload();
      router.refresh();
    } finally { setBusy(false); }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await reload();
    } finally { setBusy(false); }
  }

  async function applyAll() {
    if (!confirm('Re-apply all rules to existing transactions (last 365 days)?')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/rules/apply-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceDays: 365 }),
      }).then(r => r.json());
      alert(`Examined ${r.examined} transactions, matched ${r.matched}.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
        Rules auto-apply on every transaction insert across all import paths (CSV, QIF, SimpleFIN, Plaid, PayPal, PDF, manual). Substring or regex match against rawDescription or merchant. Apply tags, category, isTransfer flag, or rename the merchant. Lower sortOrder runs first; on a category/merchant conflict, highest sortOrder wins.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" onClick={() => setShowCreate(true)} disabled={busy}>+ New rule</Btn>
        {rules.length > 0 && (
          <Btn variant="outline" onClick={applyAll} disabled={busy}>Re-apply all to existing</Btn>
        )}
      </div>

      {showCreate && <CreateRuleForm tags={tags} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload(); router.refresh(); }} />}

      {rules.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)' }}>
          No rules yet. Create one to auto-tag or auto-categorize matching transactions.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          {rules.map(r => (
            <div key={r.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '40px 1fr auto auto', alignItems: 'center', gap: 12, opacity: r.enabled ? 1 : 0.5 }}>
              <input type="checkbox" checked={r.enabled} onChange={e => toggle(r.id, e.target.checked)} disabled={busy}
                     style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                  {r.matchType === 'regex' ? '/' : ''}{r.matchValue}{r.matchType === 'regex' ? '/' : ''}{r.caseInsensitive ? 'i' : ''} on {r.matchField}
                  {r.applyMerchant && <> → rename to <strong>{r.applyMerchant}</strong></>}
                  {r.applyCategory && <> → category <strong>{r.applyCategory}</strong></>}
                  {r.applyTagIds && JSON.parse(r.applyTagIds).length > 0 && <> → +{JSON.parse(r.applyTagIds).length} tag(s)</>}
                  {r.applyIsTransfer !== null && <> → <strong>{r.applyIsTransfer ? 'mark transfer' : 'unmark transfer'}</strong></>}
                </div>
              </div>
              <Pill tone={r.enabled ? 'success' : 'ghost'}>{r.enabled ? 'On' : 'Off'}</Pill>
              <button onClick={() => deleteRule(r.id)} disabled={busy} style={{
                fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
                padding: '4px 8px', borderRadius: 'var(--r-xs)',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--error)', cursor: 'pointer',
              }}>delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateRuleForm({ tags, onClose, onCreated }: { tags: TagOption[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [matchField, setMatchField] = useState<'rawDescription' | 'merchant'>('rawDescription');
  const [matchType, setMatchType] = useState<'substring' | 'regex'>('substring');
  const [applyMerchant, setApplyMerchant] = useState('');
  const [applyCategory, setApplyCategory] = useState('');
  const [applyTagIds, setApplyTagIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !matchValue.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          matchType, matchField, matchValue: matchValue.trim(),
          applyMerchant: applyMerchant.trim() || null,
          applyCategory: applyCategory.trim() || null,
          applyTagIds: Array.from(applyTagIds),
        }),
      });
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 14, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input placeholder="Rule name (e.g. Coffee shops)" value={name} onChange={e => setName(e.target.value)} style={inputCss} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <select value={matchField} onChange={e => setMatchField(e.target.value as any)} style={inputCss}>
          <option value="rawDescription">Match raw description</option>
          <option value="merchant">Match merchant</option>
        </select>
        <select value={matchType} onChange={e => setMatchType(e.target.value as any)} style={inputCss}>
          <option value="substring">Substring</option>
          <option value="regex">Regex</option>
        </select>
        <input placeholder="Match value" value={matchValue} onChange={e => setMatchValue(e.target.value)} style={inputCss} />
      </div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-product)', fontWeight: 700, letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase', color: 'var(--fg-muted)', marginTop: 6 }}>Apply</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input placeholder="Rename merchant to…" value={applyMerchant} onChange={e => setApplyMerchant(e.target.value)} style={inputCss} />
        <input placeholder="Set category…" value={applyCategory} onChange={e => setApplyCategory(e.target.value)} style={inputCss} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {tags.map(t => {
          const active = applyTagIds.has(t.id);
          return (
            <button key={t.id} onClick={() => setApplyTagIds(s => { const next = new Set(s); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })}
                    style={{
                      padding: '3px 8px', borderRadius: 'var(--r-pill)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'rgba(253,80,0,0.1)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--fg-muted)',
                      fontSize: 10, cursor: 'pointer',
                    }}>
              {t.parentName ? `${t.parentName}/${t.name}` : t.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={busy || !name.trim() || !matchValue.trim()}>Create rule</Btn>
      </div>
    </div>
  );
}

const inputCss: React.CSSProperties = {
  height: 32, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)',
  background: 'var(--bg)', color: 'var(--fg)',
  fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
};
