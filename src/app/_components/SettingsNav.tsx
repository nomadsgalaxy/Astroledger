'use client';

// Left rail for the settings page: scroll-spy section navigation. Sticky on
// desktop, a horizontal scrolling strip on narrow screens (see globals.css
// .settings-layout rules).
import { useEffect, useState } from 'react';

export type SettingsSection = { id: string; label: string };

export default function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {sections.map(section => {
        const isActive = active === section.id;
        return (
          <a key={section.id} href={`#${section.id}`} onClick={() => setActive(section.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            borderRadius: 'var(--r-sm)', textDecoration: 'none', whiteSpace: 'nowrap',
            border: '1px solid ' + (isActive ? 'var(--border)' : 'transparent'),
            background: isActive ? 'var(--bg-elevated)' : 'transparent',
            color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: isActive ? 700 : 500,
            position: 'relative',
          }}>
            {isActive && <span aria-hidden="true" style={{ position: 'absolute', left: -6, top: 6, bottom: 6, width: 3, background: 'var(--accent)', borderRadius: 2 }} />}
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
