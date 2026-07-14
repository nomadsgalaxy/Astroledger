import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { HexBackdrop, LogoMark, Btn } from '@/app/_components/atoms';
import PasskeySignInButton from '@/app/_components/PasskeySignInButton';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

export default function SignIn() {
  // Demo deployments never present the sign-in form - visitors who logged
  // themselves out (or hit /auth/signin directly) get re-provisioned with
  // a fresh sandbox + cookie via start-session. The disclaimer modal will
  // re-appear on next page render if their `astroledger.demo.disclaimer.v1`
  // localStorage flag was wiped along with their browser data.
  if (DEMO_MODE) redirect('/api/demo/start-session?next=%2F');

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-subtle)', position: 'relative' }}>
      <HexBackdrop opacity={0.06} color="var(--accent)" size={80} />
      <div style={{
        position: 'relative', width: 440, maxWidth: '90vw',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', padding: 36,
        display: 'flex', flexDirection: 'column', gap: 22,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoMark size={42} color="var(--accent)" />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, lineHeight: 1, letterSpacing: 'var(--tr-snug)', color: 'var(--fg-strong)', textTransform: 'uppercase' }}>
              <span style={{ color: 'var(--accent)' }}>Astro</span>ledger
            </div>
            <div className="t-caption" style={{ fontSize: 10, marginTop: 2 }}>Engineering your money</div>
          </div>
        </div>

        <div>
          <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 20, fontWeight: 700, color: 'var(--fg-strong)', margin: '0 0 4px' }}>Sign in</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>Local-first personal budgeting.</p>
        </div>

        <PasskeySignInButton />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span className="t-caption" style={{ fontSize: 10 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }); }}>
          <Btn variant="outline" type="submit" style={{ width: '100%', justifyContent: 'center' }}>
            Continue with Google
          </Btn>
        </form>

        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
          First login uses Google. After that, enroll a passkey from Settings and use it for fast sign-in.
        </div>
      </div>
    </div>
  );
}
