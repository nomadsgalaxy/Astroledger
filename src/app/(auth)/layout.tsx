// The (auth) route group renders bare - no Shell, no auth check. This is
// where /auth/signin lives so the sign-in page can render full-bleed and
// without requiring the user to already be authenticated.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
