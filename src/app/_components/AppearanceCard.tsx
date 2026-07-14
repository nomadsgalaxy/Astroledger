'use client';
import { useState, useEffect } from 'react';
import { LogoMark } from './atoms';

// Same storage key as the (now-removed) Tweaks panel - anyone with existing
// settings keeps them.
const STORAGE_KEY = 'astroledger-tweaks';
const THEME_KEY = 'astroledger-theme';

const ACCENTS = [
  { name: 'Orange',  hex: '#FD5000' },
  { name: 'Cyan',    hex: '#06B6D4' },
  { name: 'Magenta', hex: '#D946EF' },
  { name: 'Green',   hex: '#65C900' },
  { name: 'Blue',    hex: '#346EF4' },
];

type Tweaks = { accent: string; density: 'comfortable' | 'compact'; hexBackdrop: boolean };
const DEFAULTS: Tweaks = { accent: '#FD5000', density: 'comfortable', hexBackdrop: true };
type Theme = 'light' | 'dark';

function applyTweaks(t: Tweaks) {
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--accent-hover', t.accent);
  document.documentElement.dataset.density = t.density;
  document.documentElement.dataset.hexbackdrop = t.hexBackdrop ? 'on' : 'off';
}

export default function AppearanceCard() {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULTS);
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const next = { ...DEFAULTS, ...JSON.parse(raw) } as Tweaks;
        setTweaks(next);
        applyTweaks(next);
      } else {
        applyTweaks(DEFAULTS);
      }
    } catch { applyTweaks(DEFAULTS); }
    const t = (localStorage.getItem(THEME_KEY) as Theme | null) || 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  function update<K extends keyof Tweaks>(key: K, value: Tweaks[K]) {
    const next = { ...tweaks, [key]: value };
    setTweaks(next);
    applyTweaks(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  function setThemeAndApply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Section title="Theme">
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)', alignSelf: 'flex-start' }}>
          {(['dark', 'light'] as const).map(t => (
            <button key={t} onClick={() => setThemeAndApply(t)} style={tabBtn(theme === t)}>
              {t === 'dark' ? '☾ Dark' : '☀ Light'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Accent">
        <div style={{ display: 'flex', gap: 8 }}>
          {ACCENTS.map(a => (
            <button key={a.hex} onClick={() => update('accent', a.hex)} title={a.name} style={{
              width: 32, height: 32, borderRadius: 'var(--r-sm)',
              background: a.hex, border: `2px solid ${tweaks.accent === a.hex ? 'var(--fg-strong)' : 'transparent'}`,
              cursor: 'pointer',
            }} />
          ))}
        </div>
      </Section>

      <Section title="Density">
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', padding: 3, borderRadius: 'var(--r-sm)', alignSelf: 'flex-start' }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <button key={d} onClick={() => update('density', d)} style={tabBtn(tweaks.density === d)}>{d}</button>
          ))}
        </div>
      </Section>

      <Section title="Hex backdrops">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--fg)', cursor: 'pointer' }}>
          <input type="checkbox" checked={tweaks.hexBackdrop} onChange={e => update('hexBackdrop', e.target.checked)}
                 style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          Show hex pattern on hero panels
        </label>
      </Section>

      <Section title="Preview">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--r-sm)' }}>
          <LogoMark size={36} color={tweaks.accent} />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)', textTransform: 'uppercase' }}>
              <span style={{ color: tweaks.accent }}>Astro</span>ledger
            </div>
            <div className="t-caption" style={{ fontSize: 9 }}>Engineering your money</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
    letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
    padding: '6px 12px', borderRadius: 'var(--r-xs)', border: 0, cursor: 'pointer',
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
    minWidth: 90,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-caption" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
