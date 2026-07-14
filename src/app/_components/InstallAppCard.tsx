'use client';
import { useEffect, useState } from 'react';
import { Btn } from './atoms';

// Chrome/Edge expose `beforeinstallprompt` so we can show a button that
// triggers the native install dialog. Safari/iOS doesn't - show instructions
// for "Add to Home Screen" instead.
interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallAppCard() {
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'desktop' | 'ios' | 'android' | 'other'>('other');

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) setPlatform('ios');
    else if (/Android/.test(ua)) setPlatform('android');
    else setPlatform('desktop');

    const onBIP = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    setBusy(true);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setOutcome(choice.outcome === 'accepted' ? 'installed' : 'dismissed');
    setBusy(false);
    setPrompt(null);
  }

  if (installed) {
    return (
      <div style={{ fontSize: 13, color: 'var(--success)' }}>
        ✓ Installed - you're already running Astroledger as an app.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        Install Astroledger as a standalone app on this device. It opens in its own
        window, runs offline for the chrome (the data still needs a connection),
        and gets a homescreen icon. No app-store account required.
      </div>

      {prompt && (
        <Btn variant="primary" onClick={install} disabled={busy}>
          {busy ? 'Opening installer…' : 'Install Astroledger'}
        </Btn>
      )}

      {!prompt && platform === 'ios' && (
        <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
          On iPhone/iPad: tap the <strong>Share</strong> icon (square with arrow up),
          scroll down, then choose <strong>Add to Home Screen</strong>.
        </div>
      )}

      {!prompt && platform === 'android' && (
        <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
          On Android: open this page in Chrome → tap the <strong>⋮</strong> menu →
          <strong> Install app</strong> (or <strong>Add to Home screen</strong>).
        </div>
      )}

      {!prompt && platform === 'desktop' && (
        <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.6 }}>
          Look for the install icon (small square with arrow) in your browser's
          address bar. Chrome and Edge both expose it. If you don't see it,
          your browser may not support PWA install - Firefox needs an extension.
        </div>
      )}

      {outcome === 'installed' && (
        <div style={{ fontSize: 12, color: 'var(--success)' }}>✓ Installation accepted.</div>
      )}
      {outcome === 'dismissed' && (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Cancelled - you can install later from this card.</div>
      )}

      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 4 }}>
        On a phone, use the full public URL Astroledger is reachable at (typically a Cloudflare Tunnel hostname - see <code>docs/CLOUDFLARE_TUNNEL.md</code>) so the device can reach this server.
      </div>
    </div>
  );
}
