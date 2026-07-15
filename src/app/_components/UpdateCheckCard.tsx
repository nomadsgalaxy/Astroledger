'use client';

import { useEffect, useState } from 'react';

type Status = {
  currentVersion: string; latestVersion: string | null; updateAvailable: boolean;
  releaseUrl: string | null; releaseName: string | null; releaseNotes: string | null;
  publishedAt: string | null; checkedAt: string; error: string | null;
};

export default function UpdateCheckCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    try {
      const response = force
        ? await fetch('/api/updates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) })
        : await fetch('/api/updates');
      if (response.ok) setStatus(await response.json());
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  if (!status) return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Checking for updates…</div>;

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-strong)' }}>v{status.currentVersion}</span>
        {status.updateAvailable && status.latestVersion ? (
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>v{status.latestVersion} is available</span>
        ) : status.latestVersion ? (
          <span style={{ color: 'var(--fg-muted)' }}>Up to date with the latest release</span>
        ) : (
          <span style={{ color: 'var(--fg-muted)' }}>No release information yet</span>
        )}
        <span style={{ flex: 1 }} />
        <button disabled={busy} onClick={() => load(true)} style={{
          minHeight: 30, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'transparent',
          color: 'var(--fg-strong)', padding: '0 12px', fontWeight: 600, cursor: 'pointer', fontSize: 11,
        }}>{busy ? 'Checking…' : 'Check now'}</button>
      </div>
      {status.error && <div style={{ color: 'var(--negative)' }}>{status.error}</div>}
      <div style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>
        Last checked {new Date(status.checkedAt).toLocaleString()}
        {status.releaseUrl && <> · <a href={status.releaseUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>release page</a></>}
      </div>
      {status.updateAvailable && status.releaseNotes && (
        <div>
          <button onClick={() => setShowNotes(open => !open)} aria-expanded={showNotes}
            style={{ border: 0, background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}>
            {showNotes ? '▾' : '▸'} What changed in {status.releaseName ?? `v${status.latestVersion}`}
          </button>
          {showNotes && (
            <pre style={{
              marginTop: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              background: 'var(--bg)', fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--fg-muted)', maxHeight: 220, overflowY: 'auto',
            }}>{status.releaseNotes}</pre>
          )}
        </div>
      )}
      {status.updateAvailable && (
        <div>
          <button onClick={() => setShowHow(open => !open)} aria-expanded={showHow}
            style={{ border: 0, background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}>
            {showHow ? '▾' : '▸'} How to update this server
          </button>
          {showHow && (
            <pre style={{
              marginTop: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              background: 'var(--bg)', fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--fg-muted)',
            }}>{`# On the host running Astroledger (updates apply on the next boot;
# the entrypoint snapshots the encrypted database before any migration):
cd /path/to/astroledger
git pull            # or unpack the release archive over this directory
docker compose build astroledger
docker compose up -d astroledger`}</pre>
          )}
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--fg-subtle)' }}>
            Astroledger never updates itself — a running container can't rebuild its own image. Updating stays a deliberate operator step.
          </div>
        </div>
      )}
    </div>
  );
}
