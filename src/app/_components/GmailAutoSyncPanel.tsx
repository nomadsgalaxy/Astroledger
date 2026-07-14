'use client';
import { useEffect, useState } from 'react';
import { Btn, Pill } from './atoms';

type Config = { enabled: boolean; intervalMin: number; maxPerRun: number; lookbackDays: number; useLlm: boolean };
type Stats = { scanned: number; newOrders: number; skipped: number; failed: number; matched: number; llmFlags: number; llmMatches: number; durationMs: number };

export default function GmailAutoSyncPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [lastRun, setLastRun] = useState<{ lastRunAt: string | null; lastStats: Stats | null; lastError: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await fetch('/api/gmail-auto');
    if (!r.ok) { setMsg('Sign in to manage auto-sync.'); return; }
    const j = await r.json();
    setConfig(j.config);
    setLastRun({ lastRunAt: j.lastRunAt, lastStats: j.lastStats, lastError: j.lastError });
  }

  async function update(patch: Partial<Config>) {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/gmail-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json();
    if (!r.ok) { setMsg('Error: ' + j.error); setBusy(false); return; }
    setConfig(j.config);
    setBusy(false);
  }

  async function runNow() {
    setBusy(true); setMsg('Running…');
    const r = await fetch('/api/gmail-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runNow: true }) });
    const j = await r.json();
    if (!r.ok) { setMsg('Error: ' + j.error); setBusy(false); return; }
    setMsg(`Ran: ${j.stats.scanned} scanned, ${j.stats.newOrders} new, ${j.stats.llmFlags} LLM-flagged subs.`);
    await load();
    setBusy(false);
  }

  if (!config) return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{msg ?? 'Loading…'}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Pill tone={config.enabled ? 'success' : 'ghost'}>{config.enabled ? 'AUTO ON' : 'AUTO OFF'}</Pill>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg)', cursor: 'pointer' }}>
          <input type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })}
                 disabled={busy} style={{ accentColor: 'var(--accent)' }} />
          Run automatically
        </label>
        <div style={{ flex: 1 }} />
        <Btn variant="outline" size="sm" onClick={runNow} disabled={busy}>Sync now</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Row label="Every (min)" value={config.intervalMin} min={5} max={1440}
             onChange={v => update({ intervalMin: v })} disabled={busy} />
        <Row label="Max / run"   value={config.maxPerRun}   min={1} max={500}
             onChange={v => update({ maxPerRun: v })} disabled={busy} />
        <Row label="Lookback (d)" value={config.lookbackDays} min={1} max={365}
             onChange={v => update({ lookbackDays: v })} disabled={busy} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg)', cursor: 'pointer' }}>
        <input type="checkbox" checked={config.useLlm} onChange={e => update({ useLlm: e.target.checked })}
               disabled={busy} style={{ accentColor: 'var(--accent)' }} />
        Use local LLM to flag new subscriptions in receipts
      </label>

      {lastRun?.lastRunAt && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '8px 0', borderTop: '1px dashed var(--border)' }}>
          Last run: {new Date(lastRun.lastRunAt).toLocaleString()}
          {lastRun.lastStats && ` · ${lastRun.lastStats.scanned} scanned, ${lastRun.lastStats.newOrders} new, ${lastRun.lastStats.llmFlags} LLM flags, ${lastRun.lastStats.matched} matched in ${(lastRun.lastStats.durationMs / 1000).toFixed(1)}s`}
        </div>
      )}
      {lastRun?.lastError && (
        <div style={{ fontSize: 11, color: 'var(--error)', padding: '8px 0', borderTop: '1px dashed var(--border)' }}>
          Last error: {lastRun.lastError}
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{msg}</div>}
    </div>
  );
}

function Row({ label, value, min, max, onChange, disabled }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-caption">{label}</span>
      <input type="number" defaultValue={value} min={min} max={max} disabled={disabled}
        onBlur={e => { const v = parseInt(e.target.value); if (v !== value && !isNaN(v)) onChange(v); }}
        style={{
          height: 32, padding: '0 10px',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          background: 'var(--bg-elevated)', color: 'var(--fg)',
          fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
        }} />
    </label>
  );
}
