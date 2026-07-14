import { signOut } from '@/lib/auth';
import { Btn, HexBackdrop, LogoMark } from '@/app/_components/atoms';

export default function HouseholdAccessDenied() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-subtle)', position: 'relative' }}>
      <HexBackdrop opacity={0.06} color="var(--accent)" size={80} />
      <div style={{ position: 'relative', width: 440, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 36, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}><LogoMark size={38} color="var(--accent)" /><strong style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--fg-strong)' }}>Astroledger</strong></div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--fg-strong)' }}>Household access required</h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--fg-muted)', margin: '0 0 20px' }}>This account is not a member of the financial household. Ask an owner to invite your exact Google email, then sign in again.</p>
        <form action={async () => { 'use server'; await signOut({ redirectTo: '/auth/signin' }); }}><Btn variant="primary" type="submit">Sign out</Btn></form>
      </div>
    </div>
  );
}
