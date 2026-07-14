'use client';

// First-visit disclaimer for the public demo at demo.astroledger.app.
// Rendered only when DEMO_MODE=true (passed by the server layout).
//
// Behavior:
//   - On mount, if `astroledger.demo.disclaimer.v1` isn't set in localStorage,
//     auto-open the modal. The version suffix lets us re-prompt visitors if
//     the policy changes (bump to v2, all visitors see it again).
//   - Closing the modal records the version timestamp.
//   - A small floating "DEMO" pill in the bottom-right is always visible and
//     re-opens the modal on click. This doubles as a visual reminder that
//     anonymous edits aren't durable.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'astroledger.demo.disclaimer.v1';

export default function DemoDisclaimer() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      // Safari private mode + similar - fall through and show modal.
      setOpen(true);
    }
  }, []);

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch {}
    setOpen(false);
  }

  if (!mounted) return null;

  return (
    <>
      {/* Persistent pill - also serves as the "open disclaimer again" handle.
          z-index 49 sits BELOW the bottom-nav (z-index 50) so the nav's
          "Foresight" / "Settings" labels are never clipped behind the pill,
          and BELOW the transaction modal (z-index 200) so the pill doesn't
          cover modal action buttons. On mobile the pill is offset up so it
          floats above the bottom-nav bar instead of overlapping it. The
          `calc(env(...) + 72px)` matches the bottom-nav's 56px height plus
          a 16px gutter so the pill nests just above it. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Demo information"
        style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)', right: 16, zIndex: 49,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          minHeight: 32, padding: '6px 12px',
          background: '#FD5000', color: '#fff',
          border: 0, borderRadius: 999,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
          fontFamily: 'var(--font-product, system-ui)',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />
        Demo · click for info
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-disclaimer-title"
          onClick={e => { if (e.target === e.currentTarget) accept(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.72)',
            display: 'grid', placeItems: 'center',
            padding: 20, backdropFilter: 'blur(2px)',
          }}
        >
          <div style={{
            width: 'min(560px, calc(100vw - 40px))',
            maxHeight: 'calc(100vh - 40px)', overflow: 'auto',
            background: 'var(--bg-panel, #1E1E1E)',
            color: 'var(--fg, #E0E0E0)',
            border: '1px solid var(--border, #2E2E2E)',
            borderRadius: 12,
            boxShadow: '0 18px 40px rgba(0,0,0,0.7)',
            padding: '28px 28px 24px',
            fontFamily: 'var(--font-body, system-ui)',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: '#FD5000', marginBottom: 8,
              fontFamily: 'var(--font-product, system-ui)',
            }}>
              You're on the Astroledger demo
            </div>
            <h2 id="demo-disclaimer-title" style={{
              margin: '0 0 14px', fontSize: 22, fontWeight: 700, lineHeight: 1.2,
              color: 'var(--fg-strong, #fff)',
            }}>
              Read this before you click around
            </h2>

            <ul style={{
              margin: 0, padding: '0 0 0 18px',
              fontSize: 14, lineHeight: 1.55, color: 'var(--fg, #E0E0E0)',
            }}>
              <li style={{ marginBottom: 10 }}>
                Everything here is <strong>seeded fake data</strong> for a fictional user.
                No real accounts, no real money.
              </li>
              <li style={{ marginBottom: 10 }}>
                You're in <strong>your own private sandbox</strong> - other visitors won't see your edits,
                and yours will disappear automatically after 30 minutes of inactivity
                (or sooner if the demo hits its capacity cap).
                Treat your session as throwaway.
              </li>
              <li style={{ marginBottom: 10 }}>
                This is a <strong>demonstration</strong> of the Astroledger app, not a service.
                Don't enter real personal or financial information.
              </li>
              <li style={{ marginBottom: 0 }}>
                The built-in AI assistant is <strong>not licensed to give financial advice</strong>.
                It only helps identify merchants and explain where money went - 
                anything resembling investment, tax, or planning advice is out of scope.
              </li>
            </ul>

            <div style={{
              marginTop: 22, display: 'flex', flexDirection: 'column', gap: 8,
              alignItems: 'stretch',
            }}>
              <button onClick={accept} style={{
                minHeight: 44, padding: '10px 18px',
                background: '#FD5000', color: '#fff',
                border: 0, borderRadius: 'var(--r-sm, 6px)',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', cursor: 'pointer',
                fontFamily: 'var(--font-product, system-ui)',
              }}>
                I understand - let me explore
              </button>
              <a
                href="https://github.com/nomadsgalaxy/Astroledger"
                target="_blank" rel="noreferrer"
                style={{
                  textAlign: 'center', minHeight: 36, padding: '8px 14px',
                  border: '1px solid var(--border-strong, #555)',
                  borderRadius: 'var(--r-sm, 6px)',
                  fontSize: 12, fontWeight: 600,
                  color: 'var(--fg-muted, #B0B0B0)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-product, system-ui)',
                }}
              >
                Source on GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
