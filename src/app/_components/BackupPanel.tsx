'use client';
import { useEffect, useState } from 'react';
import { Btn, Pill, fmt } from './atoms';

type Config = { enabled: boolean; intervalHours: number; retentionDays: number; destDir: string };
type Result = { filename: string; bytes: number; durationMs: number; pruned: number; encrypted?: boolean };
type Backup = { name: string; bytes: number; mtime: string; encrypted?: boolean };

const MIN_PW = 12;

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function BackupPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [last, setLast]     = useState<{ lastRunAt: string | null; lastResult: Result | null; lastError: string | null } | null>(null);
  const [list, setList]     = useState<Backup[]>([]);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);

  // Encrypt-on-backup state.
  const [encOn, setEncOn]   = useState(false);
  const [pw, setPw]         = useState('');
  const [pw2, setPw2]       = useState('');

  // Per-row restore/verify state (keyed by backup name).
  const [rowAction, setRowAction] = useState<{ name: string; mode: 'restore' | 'verify'; needsPw: boolean; pw: string; err: string | null } | null>(null);
  // Restore confirm dialog: carries whether the target is encrypted + a password field.
  const [confirmRestore, setConfirmRestore] = useState<{ name: string; encrypted: boolean; pw: string; err: string | null } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await fetch('/api/backup');
    if (!r.ok) { setMsg('Sign in to manage backups.'); return; }
    const j = await r.json();
    setConfig(j.config);
    setLast({ lastRunAt: j.lastRunAt, lastResult: j.lastResult, lastError: j.lastError });
    setList(j.backups ?? []);
  }

  async function update(patch: Partial<Config>) {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg('Error: ' + j.error); return; }
    setConfig(j.config);
  }

  const pwValid = !encOn || (pw.length >= MIN_PW && pw === pw2);

  async function runNow() {
    if (encOn && !pwValid) { setMsg('Error: passwords must match and be at least 12 characters.'); return; }
    setBusy(true); setMsg(encOn ? 'Encrypting backup…' : 'Backing up…');
    const r = await fetch('/api/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encOn ? { runNow: true, password: pw } : { runNow: true }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg('Error: ' + (j.error ?? 'backup failed')); return; }
    setMsg(`Wrote ${j.stats.filename}${j.stats.encrypted ? ' 🔒' : ''} · ${humanBytes(j.stats.bytes)} · pruned ${j.stats.pruned}`);
    setPw(''); setPw2(''); // never keep the password in component state
    await load();
  }

  // Restore (or verify) a backup. Handles the encrypted-needs-password round-trip.
  async function doRowAction(name: string, mode: 'restore' | 'verify', password?: string) {
    setBusy(true);
    const key = mode === 'restore' ? 'restore' : 'verifyBackup';
    const r = await fetch('/api/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: name, ...(password ? { password } : {}) }),
    });
    const j = await r.json();
    setBusy(false);
    if (r.status === 422 && j.needsPassword) {
      // Encrypted + no/blank password. For restore, surface it in the confirm
      // dialog's password field; for verify, the inline row field.
      if (mode === 'restore') setConfirmRestore({ name, encrypted: true, pw: '', err: null });
      else setRowAction({ name, mode, needsPw: true, pw: '', err: null });
      return;
    }
    if (!r.ok) {
      if (j.code === 'BAD_PASSWORD' && mode === 'restore') {
        setConfirmRestore({ name, encrypted: true, pw: '', err: j.error });
      } else if (j.code === 'BAD_PASSWORD' && rowAction?.name === name) {
        setRowAction({ name, mode, needsPw: true, pw: '', err: j.error });
      } else {
        setMsg('Error: ' + (j.error ?? 'failed'));
        setRowAction(null);
      }
      return;
    }
    setRowAction(null);
    setConfirmRestore(null);
    if (mode === 'verify') {
      setMsg(`${name}: ${j.verify.ok ? '✓ restorable' : '✗ ' + j.verify.detail}${j.verify.encrypted ? ' 🔒' : ''}`);
    } else {
      setMsg(`Restored from ${j.result.restoredFrom}. Safety copy: ${j.result.safetyCopy}. App is restarting…`);
    }
    await load();
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
        <Btn variant="outline" size="sm" onClick={runNow} disabled={busy || (encOn && !pwValid)}>Back up now</Btn>
      </div>

      {/* Encrypt-this-backup toggle (on-demand only; scheduled backups stay plain). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-subtle)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg)', cursor: 'pointer' }}>
          <input type="checkbox" checked={encOn} onChange={e => { setEncOn(e.target.checked); if (!e.target.checked) { setPw(''); setPw2(''); } }}
                 disabled={busy} style={{ accentColor: 'var(--accent)' }} />
          Encrypt this backup with a password
        </label>
        {encOn && (
          <>
            <div style={{ fontSize: 11, color: 'var(--warning)', lineHeight: 1.5 }}>
              This password is the <strong>only</strong> way to restore this file — your MASTER_KEY cannot recover it,
              and we cannot reset it. Once encrypted, the file is safe to store off-device.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="password" placeholder="Password (min 12 chars)" value={pw} onChange={e => setPw(e.target.value)}
                     disabled={busy} style={{ ...input, flex: 1, minWidth: 160 }} autoComplete="new-password" />
              <input type="password" placeholder="Confirm password" value={pw2} onChange={e => setPw2(e.target.value)}
                     disabled={busy} style={{ ...input, flex: 1, minWidth: 160 }} autoComplete="new-password" />
            </div>
            {pw.length > 0 && pw.length < MIN_PW && <div style={{ fontSize: 11, color: 'var(--error)' }}>Min 12 characters.</div>}
            {pw2.length > 0 && pw !== pw2 && <div style={{ fontSize: 11, color: 'var(--error)' }}>Passwords don&apos;t match.</div>}
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Row label="Every (hours)" value={config.intervalHours} step={0.5} min={0.5} max={720}
             onChange={v => update({ intervalHours: v })} disabled={busy} />
        <Row label="Retention (days)" value={config.retentionDays} step={1} min={1} max={3650}
             onChange={v => update({ retentionDays: v })} disabled={busy} />
        <DestRow value={config.destDir} onSave={v => update({ destDir: v })} disabled={busy} />
      </div>

      {last?.lastRunAt && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
          Last run: {new Date(last.lastRunAt).toLocaleString()}
          {last.lastResult && ` · ${last.lastResult.filename} · ${humanBytes(last.lastResult.bytes)} · ${(last.lastResult.durationMs / 1000).toFixed(1)}s`}
        </div>
      )}
      {last?.lastError && (
        <div style={{ fontSize: 11, color: 'var(--error)', paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
          Last error: {last.lastError}
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--error)' : 'var(--fg-muted)' }}>{msg}</div>}

      {list.length > 0 && (
        <div>
          <div className="t-caption" style={{ marginBottom: 6 }}>Backups on disk ({list.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', maxHeight: 180, overflowY: 'auto' }}>
            {list.slice(0, 30).map(b => (
              <div key={b.name} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {b.encrypted && <Pill tone="ghost">🔒 LOCKED</Pill>}
                    {b.name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {humanBytes(b.bytes)} · {new Date(b.mtime).toLocaleString()}
                    <Btn variant="ghost" size="sm" disabled={busy}
                         onClick={() => doRowAction(b.name, 'verify', b.encrypted && rowAction?.name === b.name ? rowAction.pw : undefined)}>Test</Btn>
                    <Btn variant="outline" size="sm" disabled={busy} onClick={() => setConfirmRestore({ name: b.name, encrypted: !!b.encrypted, pw: '', err: null })}>Restore</Btn>
                  </span>
                </div>
                {rowAction?.name === b.name && rowAction.needsPw && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 8 }}>
                    <input type="password" placeholder="Backup password" value={rowAction.pw} autoFocus autoComplete="off"
                           onChange={e => setRowAction({ ...rowAction, pw: e.target.value, err: null })}
                           style={{ ...input, flex: 1, maxWidth: 240 }} />
                    <Btn variant="primary" size="sm" disabled={busy || !rowAction.pw}
                         onClick={() => doRowAction(b.name, rowAction.mode, rowAction.pw)}>
                      {rowAction.mode === 'restore' ? 'Restore' : 'Test'}
                    </Btn>
                    <Btn variant="ghost" size="sm" onClick={() => setRowAction(null)}>Cancel</Btn>
                    {rowAction.err && <span style={{ fontSize: 11, color: 'var(--error)' }}>{rowAction.err}</span>}
                  </div>
                )}
              </div>
            ))}
            {list.length > 30 && <div style={{ paddingTop: 4 }}>… {list.length - 30} more</div>}
          </div>
        </div>
      )}

      {confirmRestore && (
        <div onClick={() => setConfirmRestore(null)} role="dialog" aria-modal="true"
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, calc(100vw - 40px))', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)', marginBottom: 10 }}>Restore this backup?</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55, marginBottom: 16 }}>
              This <strong>replaces your live database</strong> with <code style={{ fontSize: 11 }}>{confirmRestore.name}</code> and
              restarts the app. A safety copy of the current database is made first, and the backup is integrity-checked
              before the swap — if either fails, your live data is left untouched.
            </div>
            {confirmRestore.encrypted && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
                  <Pill tone="ghost">🔒 LOCKED</Pill> This backup is password-encrypted.
                </div>
                <input type="password" placeholder="Backup password" value={confirmRestore.pw} autoFocus autoComplete="off"
                       onChange={e => setConfirmRestore({ ...confirmRestore, pw: e.target.value, err: null })}
                       style={{ ...input, width: '100%' }} />
                {confirmRestore.err && <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 6 }}>{confirmRestore.err}</div>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmRestore(null)}>Cancel</Btn>
              <Btn variant="primary" size="sm" disabled={busy || (confirmRestore.encrypted && !confirmRestore.pw)}
                   onClick={() => doRowAction(confirmRestore.name, 'restore', confirmRestore.encrypted ? confirmRestore.pw : undefined)}>
                Restore
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, min, max, step, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-caption">{label}</span>
      <input type="number" defaultValue={value} min={min} max={max} step={step} disabled={disabled}
        onBlur={e => { const v = parseFloat(e.target.value); if (v !== value && !isNaN(v)) onChange(v); }}
        style={input} />
    </label>
  );
}

function DestRow({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 1' }}>
      <span className="t-caption">Destination directory</span>
      <input type="text" defaultValue={value} disabled={disabled}
        onBlur={e => { if (e.target.value !== value) onSave(e.target.value); }}
        style={input} />
    </label>
  );
}

const input: React.CSSProperties = {
  height: 32, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg)',
  fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
};
