'use client';
import Link from 'next/link';
// Visual sibling of ChipBtn - but rendered as a Link so back/forward work.
// Styled to match: 28px height, same font + border treatment.

// Small inline toggle on /accounts: switches the ?showHidden=1 query param.
// When showHidden is false, displays "Show N inactive"; when true, "Hide N inactive".
export default function HiddenAccountsToggle({ showHidden, hiddenCount, thresholdMonths }: {
  showHidden: boolean; hiddenCount: number; thresholdMonths: number;
}) {
  const href = showHidden ? '/accounts' : '/accounts?showHidden=1';
  const label = showHidden ? `Hide ${hiddenCount} inactive` : `Show ${hiddenCount} inactive`;
  return (
    <Link
      href={href}
      title={`Accounts with no activity in ${thresholdMonths}+ months. Change the threshold in Settings.`}
      style={{
        fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
        letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
        height: 28, padding: '0 10px', borderRadius: 'var(--r-xs)',
        background: 'transparent', color: 'var(--fg-muted)',
        border: '1px solid var(--border)', textDecoration: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1,
        boxSizing: 'border-box',
      }}
    >
      {showHidden ? '◐' : '○'} {label}
    </Link>
  );
}
