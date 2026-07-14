'use client';
import { useState, useEffect, CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Hex, LogoMark } from './atoms';
import TimeRangeFilter from './TimeRangeFilter';
import TransactionDetailModal from './TransactionDetailModal';
import NotificationBell from './NotificationBell';
import { Suspense } from 'react';
import type { RangeKey } from '@/lib/timeRange';
import { CURRENCY_RE, maskCurrency } from '@/lib/privacy';

type ViewMode = 'simple' | 'advanced' | 'expert';
type NavItem = { name: string; href: string; icon: string; visibleIn?: ViewMode[] };
type NavGroup = { id: string; label?: string; items: NavItem[] };

// Visibility rule of thumb:
//   simple   → daily essentials only (~9 items)
//   advanced → most pages
//   expert   → everything
// Pages absent from a level are hidden in that level.
const ALL: ViewMode[] = ['simple', 'advanced', 'expert'];
const ADV: ViewMode[] = ['advanced', 'expert'];
const EXP: ViewMode[] = ['expert'];

const NAV_GROUPS: NavGroup[] = [
  { id: 'overview', items: [
    { name: 'Overview', href: '/', icon: '◯', visibleIn: ALL },
  ]},
  { id: 'activity', label: 'Activity', items: [
    { name: 'Transactions',    href: '/transactions',     icon: '☰', visibleIn: ALL },
    { name: 'Cashflow',        href: '/cashflow',         icon: '⇌', visibleIn: ALL },
    { name: 'Recurring',       href: '/schedule',         icon: '↻', visibleIn: ALL },
    { name: 'Tag assistant',   href: '/tags/assist',      icon: '◇', visibleIn: ADV },
    { name: 'Transfer review', href: '/transfers/review', icon: '⇆', visibleIn: ADV },
    { name: 'Merchants',       href: '/merchants',        icon: '☐', visibleIn: ADV },
    { name: 'Orders',          href: '/orders',           icon: '⌒', visibleIn: ADV },
  ]},
  { id: 'position', label: 'Accounts', items: [
    { name: 'Spaces & sharing', href: '/spaces', icon: 'S', visibleIn: ALL },
    { name: 'Accounts',      href: '/accounts',      icon: '▤', visibleIn: ALL },
    { name: 'Net worth',     href: '/networth',      icon: '△', visibleIn: ALL },
    { name: 'Holdings',      href: '/holdings',      icon: '◇', visibleIn: ADV },
    { name: 'Subscriptions', href: '/subscriptions', icon: '↻', visibleIn: ADV },
    { name: 'Bills',         href: '/bills',         icon: '⌽', visibleIn: ADV },
  ]},
  { id: 'planning', label: 'Plan', items: [
    { name: 'Budgets',    href: '/budgets',  icon: '⬡', visibleIn: ALL },
    { name: 'Foresight',  href: '/forecast', icon: '∿', visibleIn: ALL },
  ]},
  { id: 'review', label: 'Review', items: [
    { name: 'Insights',   href: '/alerts',     icon: '◔', visibleIn: ALL },
    { name: 'Reports',    href: '/reports',    icon: '▦', visibleIn: ADV },
    { name: 'Tax',        href: '/tax',        icon: '§', visibleIn: ADV },
    { name: 'Mileage',    href: '/mileage',    icon: '⇸', visibleIn: ADV },
    { name: 'Ask Spacer', href: '/chat',       icon: '✦', visibleIn: ALL },
    { name: 'Benchmarks', href: '/benchmarks', icon: '◊', visibleIn: EXP },
  ]},
];

const iconBtn: CSSProperties = {
  width: 36, height: 36,
  display: 'grid', placeItems: 'center',
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
  cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-product)',
};

const COLLAPSE_KEY = 'astroledger-sidebar-collapsed-groups';

function Sidebar({ collapsed, onToggle, viewMode, mobileOpen, onMobileClose }: {
  collapsed: boolean; onToggle: () => void; viewMode: ViewMode;
  mobileOpen: boolean; onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsedGroups(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  return (
    <>
    <div className="m3-sidebar-backdrop" data-open={mobileOpen ? 'true' : 'false'} onClick={onMobileClose} />
    <aside className="m3-sidebar" data-open={mobileOpen ? 'true' : 'false'} style={{
      background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)',
      width: collapsed ? 64 : 232, display: 'flex', flexDirection: 'column',
      transition: 'width var(--dur-base) var(--ease-out)',
      flexShrink: 0, overflow: 'hidden', height: '100vh', position: 'sticky', top: 0,
    }}>
      <div style={{
        padding: collapsed ? '20px 0' : '20px 18px',
        display: 'flex', alignItems: 'center', gap: 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--border)', minHeight: 72,
      }}>
        <LogoMark size={26} color="var(--accent)" />
        {!collapsed && (
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, lineHeight: 1, letterSpacing: 'var(--tr-snug)', color: 'var(--fg-strong)', textTransform: 'uppercase' }}>
              <span style={{ color: 'var(--accent)' }}>Astro</span>ledger
            </div>
            <div className="t-caption" style={{ fontSize: 9, color: 'var(--fg-subtle)', marginTop: 2 }}>Engineering your money</div>
          </div>
        )}
      </div>

      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV_GROUPS.map((group, gi) => {
          const visibleItems = group.items.filter(i => !i.visibleIn || i.visibleIn.includes(viewMode));
          if (visibleItems.length === 0) return null;
          const containsActive = visibleItems.some(i =>
            pathname === i.href || (i.href !== '/' && pathname.startsWith(i.href + '/'))
          );
          // Active group is always expanded so the user sees where they are.
          const userCollapsed = collapsedGroups.has(group.id);
          const isOpen = containsActive || !userCollapsed;

          return (
            <div key={group.id} style={{ marginBottom: gi < NAV_GROUPS.length - 1 ? 8 : 0 }}>
              {!collapsed && group.label && (
                <button onClick={() => toggleGroup(group.id)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 12px 4px', background: 'transparent', border: 0, cursor: 'pointer',
                }}
                  title={isOpen ? 'Collapse' : 'Expand'}>
                  <span className="t-caption" style={{
                    fontSize: 9, color: containsActive ? 'var(--accent)' : 'var(--fg-subtle)',
                  }}>{group.label}</span>
                  <span style={{
                    fontSize: 9, color: 'var(--fg-subtle)',
                    transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform var(--dur-fast)',
                  }}>▾</span>
                </button>
              )}
              {collapsed && gi > 0 && (
                <div style={{ height: 1, background: 'var(--border)', margin: '8px 10px' }} />
              )}
              {(collapsed || isOpen) && visibleItems.map(item => {
                const isActive = pathname === item.href
                  || (item.href !== '/' && pathname.startsWith(item.href + '/'));
                return (
                  <Link key={item.href} href={item.href} title={item.name} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: collapsed ? '10px' : '8px 12px', margin: '1px 0',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid ' + (isActive ? 'var(--border)' : 'transparent'),
                    background: isActive ? 'var(--bg-elevated)' : 'transparent',
                    textDecoration: 'none', textAlign: 'left',
                    color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
                    fontFamily: 'var(--font-body)', fontSize: 13,
                    fontWeight: isActive ? 600 : 500, position: 'relative',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    transition: 'var(--dur-fast)',
                  }}>
                    {isActive && <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 3, background: 'var(--accent)', borderRadius: 2 }} />}
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: isActive ? 'var(--accent)' : 'inherit', width: 16, display: 'inline-grid', placeItems: 'center' }}>{item.icon}</span>
                    {!collapsed && <span style={{ flex: 1 }}>{item.name}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
        <Link href="/connect" style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '10px' : '10px 12px',
          background: 'var(--bg-elevated)', border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11, letterSpacing: 'var(--tr-wider)',
          textTransform: 'uppercase', color: 'var(--fg-strong)', textDecoration: 'none',
        }}>
          <span style={{ color: 'var(--accent)', fontSize: 16 }}>⚙</span>
          {!collapsed && <span>Manage data</span>}
        </Link>
      </div>

      <button onClick={onToggle} style={{
        margin: '0 12px 12px', padding: '6px',
        background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)', cursor: 'pointer',
        color: 'var(--fg-muted)', fontSize: 12,
      }}>{collapsed ? '›' : '‹ collapse'}</button>
    </aside>
    </>
  );
}

// Material 3-inspired bottom navigation for phones (≤ 600px).
// Top-level destinations only - full nav stays in the drawer (hamburger).
function BottomNav() {
  const pathname = usePathname();
  const items = [
    { label: 'Home',         href: '/',             icon: '◯' },
    { label: 'Activity',     href: '/transactions', icon: '☰' },
    { label: 'Accounts',     href: '/accounts',     icon: '▤' },
    { label: 'Foresight',    href: '/forecast',     icon: '∿' },
    { label: 'Settings',     href: '/settings',     icon: '⚙' },
  ];
  return (
    <nav className="m3-bottom-nav" aria-label="Primary navigation" style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'stretch',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-elevated)', zIndex: 50,
      paddingBottom: 'env(safe-area-inset-bottom, 0)',
    }}>
      {items.map(item => {
        const active = pathname === item.href
          || (item.href === '/transactions' && /^\/(transactions|cashflow|tags|transfers|merchants|orders|subscriptions|bills|schedule)(\/|$)/.test(pathname))
          || (item.href === '/accounts' && /^\/(accounts|networth|holdings)(\/|$)/.test(pathname))
          || (item.href === '/forecast' && /^\/(forecast|plans|envelopes|checkpoint|goals|debt|scenarios)(\/|$)/.test(pathname));
        return (
          <Link key={item.href} href={item.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '8px 4px', minHeight: 56,
            color: active ? 'var(--accent)' : 'var(--fg-muted)',
            textDecoration: 'none', position: 'relative',
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600,
            letterSpacing: 'var(--tr-snug)',
          }}>
            {active && (
              <span style={{
                position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                width: 40, height: 3, background: 'var(--accent)',
                borderRadius: '0 0 4px 4px',
              }} />
            )}
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, lineHeight: 1,
              marginBottom: 4,
            }}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

type SpaceSwitcherData = { activeSpaceId: string; spaces: Array<{ id: string; name: string; kind: string; role: string }> };

function SpaceSwitcher({ data }: { data: SpaceSwitcherData }) {
  const [busy, setBusy] = useState(false);
  const change = async (spaceId: string) => {
    if (!spaceId || spaceId === data.activeSpaceId) return;
    setBusy(true);
    const response = await fetch('/api/financial-spaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select_space', spaceId }),
    });
    if (response.ok) window.location.reload();
    else setBusy(false);
  };
  return (
    <select aria-label="Active financial space" title="Active financial space"
      value={data.activeSpaceId} disabled={busy} onChange={event => change(event.target.value)}
      style={{ height: 36, maxWidth: 210, padding: '0 28px 0 10px', border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)', color: 'var(--fg-strong)',
        fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600 }}>
      {data.spaces.map(space => <option key={space.id} value={space.id}>
        {space.kind === 'personal' ? 'Personal' : space.kind === 'stewarded' ? 'Stewarded' : 'Household'} · {space.name}
      </option>)}
    </select>
  );
}

function TopBar({ theme, onTheme, viewMode, onViewMode, rangeKey, onMobileMenu, userName, privacy, onPrivacy, spaceSwitcher }: {
  theme: 'light' | 'dark'; onTheme: () => void;
  viewMode: 'simple' | 'advanced' | 'expert'; onViewMode: (m: 'simple' | 'advanced' | 'expert') => void;
  rangeKey: RangeKey;
  onMobileMenu: () => void;
  userName: string;
  privacy: boolean; onPrivacy: () => void;
  spaceSwitcher: SpaceSwitcherData;
}) {
  // First non-empty word's initial; fall back to "U" if userName is empty.
  const initial = (userName.trim().split(/\s+/)[0]?.[0] ?? 'U').toUpperCase();
  const displayName = userName.includes('@')
    ? userName.split('@')[0]               // for emails: show local-part
    : userName.split(/\s+/)[0];            // for full names: show first name

  const modes = [
    { id: 'simple' as const,   label: 'Simple',   color: 'var(--mode-simple)',   desc: 'Big numbers, recent activity' },
    { id: 'advanced' as const, label: 'Advanced', color: 'var(--mode-advanced)', desc: 'Full tables, trends, cashflow' },
    { id: 'expert' as const,   label: 'Expert',   color: 'var(--mode-expert)',   desc: 'Raw data, every cell, no chrome' },
  ];
  return (
    <header style={{
      height: 60, borderBottom: '1px solid var(--border)', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12,
      flexShrink: 0, position: 'sticky', top: 0, zIndex: 5,
    }}>
      <button className="m3-hamburger" onClick={onMobileMenu} style={{
        ...iconBtn, display: 'none', // hidden on desktop via CSS
      }} title="Open menu" aria-label="Open navigation menu">☰</button>
      <SpaceSwitcher data={spaceSwitcher} />
      <div className="m3-topbar-search" style={{ flex: 1, maxWidth: 540, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-subtle)', fontSize: 13 }}>⌕</span>
        <input
          placeholder="Search transactions, merchants, categories…"
          style={{
            width: '100%', height: 36, padding: '0 12px 0 32px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--bg-elevated)', color: 'var(--fg)',
            fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
          }} />
      </div>
      <div style={{ flex: 1 }} />
      <TimeRangeFilter value={rangeKey} />
      <div className="m3-topbar-mode" title="View density" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px 4px 12px', border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)', background: 'var(--bg-elevated)',
      }}>
        <span className="t-caption" style={{ fontSize: 9 }}>Mode</span>
        {modes.map(m => (
          <Hex key={m.id} size={18} color={m.color} title={`${m.label} - ${m.desc}`} onClick={() => onViewMode(m.id)}
               style={{ opacity: viewMode === m.id ? 1 : 0.35, boxShadow: viewMode === m.id ? '0 0 0 1px rgba(0,0,0,0.15)' : 'none' }} />
        ))}
      </div>
      <button onClick={onPrivacy} className="m3-topbar-privacy" style={{ ...iconBtn, color: privacy ? 'var(--accent)' : undefined }}
              title={privacy ? 'Privacy mode ON - click to show amounts' : 'Privacy mode OFF - click to hide amounts'}
              aria-label={privacy ? 'Privacy mode on. Click to show amounts.' : 'Privacy mode off. Click to hide amounts.'}
              aria-pressed={privacy}>
        <span aria-hidden="true">{privacy ? '⊘' : '◉'}</span>
      </button>
      <button onClick={onTheme} className="m3-topbar-theme" style={iconBtn}
              title="Toggle theme"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      </button>
      <Link href="/settings" className="m3-topbar-settings" style={iconBtn} title="Settings" aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </Link>
      <Link href="/alerts" style={{ ...iconBtn, position: 'relative', textDecoration: 'none' }} title="Alerts" aria-label="Alerts">
        <span style={{ fontSize: 14 }} aria-hidden="true">◔</span>
        <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 'var(--r-pill)', background: 'var(--accent)' }} aria-hidden="true" />
      </Link>
      <NotificationBell />
      <Link href="/settings" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 4px',
        border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', background: 'var(--bg-elevated)',
        textDecoration: 'none' }}>
        <div style={{ width: 28, height: 28, borderRadius: 'var(--r-pill)',
          background: 'linear-gradient(140deg, var(--accent), var(--orange-copper))',
          color: '#fff', display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11 }}>{initial}</div>
        <span className="m3-avatar-name" style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{displayName}</span>
      </Link>
    </header>
  );
}

export default function Shell({ children, rangeKey, userName, spaceSwitcher }: { children: React.ReactNode; rangeKey: RangeKey; userName: string; spaceSwitcher: SpaceSwitcherData }) {
  // Note: the (auth) route group already skips Shell entirely. The pathname
  // guard below is belt-and-suspenders for any future legacy /auth/* routes.
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [viewMode, setViewMode] = useState<ViewMode>('advanced');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem('astroledger-theme') as 'light' | 'dark') || 'dark';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
    const savedMode = localStorage.getItem('astroledger-viewmode') as ViewMode | null;
    if (savedMode === 'simple' || savedMode === 'advanced' || savedMode === 'expert') setViewMode(savedMode);
    const savedPrivacy = localStorage.getItem('astroledger-privacy') === '1';
    setPrivacy(savedPrivacy);
    if (savedPrivacy) document.documentElement.setAttribute('data-privacy', 'on');
  }, []);

  const togglePrivacy = () => {
    const next = !privacy;
    setPrivacy(next);
    if (next) document.documentElement.setAttribute('data-privacy', 'on');
    else document.documentElement.removeAttribute('data-privacy');
    try { localStorage.setItem('astroledger-privacy', next ? '1' : '0'); } catch {}
  };

  // Persist view-mode changes across reloads.
  const updateViewMode = (m: ViewMode) => {
    setViewMode(m);
    try { localStorage.setItem('astroledger-viewmode', m); } catch {}
  };

  if (pathname?.startsWith('/auth/')) return <>{children}</>;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('astroledger-theme', next);
  };

  // Close drawer when navigating
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  // Privacy auto-tagger: when privacy mode is on, walk the whole document
  // body (so modals, dropdowns, and portal-rendered overlays are covered)
  // and replace every currency-like substring ($1,234 → $X,XXX) in leaf
  // text nodes. The original textContent is stashed on
  // `data-privacy-original` so toggling privacy off restores the real
  // value. Nav containers (top bar, sidebar, bottom-nav, demo pill) are
  // skipped at the subtree level so currency genuinely shown in nav stays
  // readable. A MutationObserver catches modals + Counter animations.
  // The masking is idempotent: once a value reads as "$X,XXX" the
  // currency regex no longer matches the post-mask text, so the observer
  // doesn't infinite-loop on its own writes.
  useEffect(() => {
    if (!privacy) {
      document.querySelectorAll<HTMLElement>('[data-privacy-original]').forEach(el => {
        const orig = el.getAttribute('data-privacy-original');
        if (orig !== null) el.textContent = orig;
        el.removeAttribute('data-privacy-original');
      });
      return;
    }
    // Helpers extracted to lib/privacy.ts so the masking is unit-testable
    // and any future surface (server-side renders, exports) shares one
    // implementation.
    const currencyRe = CURRENCY_RE;
    const maskText = maskCurrency;
    const skipTags = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'NAV']);
    const inNavScope = (el: Element): boolean =>
      !!el.closest('header, .m3-sidebar, .m3-bottom-nav, .m3-topbar-search, [data-privacy-keep]');
    const tag = () => {
      const root = document.body;
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode as Element | null;
      while (node) {
        const el = node as HTMLElement;
        if (
          !skipTags.has(el.tagName) &&
          el.children.length === 0 &&
          !inNavScope(el)
        ) {
          const txt = el.textContent || '';
          if (currencyRe.test(txt)) {
            const masked = maskText(txt);
            if (masked !== txt) {
              if (!el.hasAttribute('data-privacy-original')) {
                el.setAttribute('data-privacy-original', txt);
              }
              el.textContent = masked;
            }
          }
        }
        node = walker.nextNode() as Element | null;
      }
    };
    tag();
    const handles = [
      setTimeout(tag, 300),
      setTimeout(tag, 1000),
      setTimeout(tag, 2500),
    ];
    const interval = setInterval(tag, 4000);
    const observer = new MutationObserver(() => tag());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      handles.forEach(clearTimeout);
      clearInterval(interval);
      observer.disconnect();
    };
  }, [privacy, pathname]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        viewMode={viewMode}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar theme={theme} onTheme={toggleTheme} viewMode={viewMode} onViewMode={updateViewMode} rangeKey={rangeKey} userName={userName} spaceSwitcher={spaceSwitcher}
                onMobileMenu={() => setMobileNavOpen(true)} privacy={privacy} onPrivacy={togglePrivacy} />
        <main style={{ flex: 1, padding: '32px 32px 48px', maxWidth: 1440, width: '100%', alignSelf: 'flex-start' }}>
          {children}
        </main>
      </div>
      <BottomNav />
      {/* Globally mounted - opens when ?tx=<id> is in the URL. Suspense
          required because the modal's child reads useSearchParams. */}
      <Suspense fallback={null}><TransactionDetailModal /></Suspense>
    </div>
  );
}
