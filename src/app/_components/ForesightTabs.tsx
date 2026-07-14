'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Foresight tab strip. Lives as a client island inside the (foresight)
// server layout so the active state tracks the live pathname instead of a
// (possibly stale) request header.
const TABS = [
  { href: '/forecast',   label: 'Forecast',   desc: '12-mo composite + 5-yr extrapolation' },
  { href: '/schedule',   label: 'Recurring',  desc: 'Income, bills, and subscriptions on one schedule' },
  { href: '/scenarios',  label: 'Scenarios',  desc: 'What-if adjustments + savings runway' },
  { href: '/plans',      label: 'Plans',      desc: 'Versioned monthly budgets' },
  { href: '/envelopes',  label: 'Envelopes',  desc: 'Per-month dollar allocations vs spending' },
  { href: '/goals',      label: 'Goals',      desc: 'Savings targets + debt payoff + spend caps' },
  { href: '/debt',       label: 'Debt',       desc: 'Avalanche vs snowball payoff planner' },
  { href: '/checkpoint', label: 'Checkpoint', desc: 'Plan vs actual right now' },
];

export default function ForesightTabs() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="m3-tab-strip" aria-label="Foresight sections" style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
      {TABS.map(t => {
        const active = pathname === t.href
          || (t.href === '/plans'      && pathname.startsWith('/plans/'))
          || (t.href === '/goals'      && pathname.startsWith('/goals/'))
          || (t.href === '/envelopes'  && pathname.startsWith('/envelopes/'));
        return (
          <Link key={t.href} href={t.href} title={t.desc} style={{
            padding: '10px 18px',
            borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
            color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
            fontFamily: 'var(--font-product)', fontWeight: 700, fontSize: 11,
            letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
            textDecoration: 'none', transition: 'var(--dur-fast)',
            marginBottom: -1,
          }} aria-current={active ? 'page' : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
