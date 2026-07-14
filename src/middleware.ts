// Edge-runtime-safe middleware. Just checks for the session cookie's presence;
// real session validation happens in server pages/route handlers via auth().
//
// Why not NextAuth here? NextAuth's PrismaAdapter can't run on Edge, and
// database-strategy sessions require an adapter to verify - so middleware can
// only do a cheap cookie sniff. Page-level auth() does the full verify.
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/auth', '/api/auth', '/api/webauthn', '/_next',
  // /api/mcp authenticates internally via session OR MCP_TOKEN bearer.
  '/api/mcp',
  // Health/readiness probe — must be reachable unauthenticated for the Docker
  // HEALTHCHECK + compose depends_on. Leaks nothing sensitive (liveness booleans).
  '/api/health',
  // Cron endpoints authenticate internally via the CRON_SECRET bearer (no
  // session cookie). They must bypass the cookie-sniff guard so external
  // schedulers (Task Scheduler, systemd timer, GitHub Actions) can reach them.
  '/api/cron',
  // Static branding/PWA assets must be reachable WITHOUT a session: social
  // crawlers fetching the OG image are never authenticated, the browser
  // requests the manifest + icons before sign-in, and the service worker must
  // register pre-auth. They leak nothing. (favicon.ico is already excluded by
  // the matcher below.)
  '/icons', '/manifest.webmanifest', '/sw.js',
  // Demo-mode auto-signin endpoint. Idempotent; gated by DEMO_MODE inside.
  '/api/demo'];

const DEMO_MODE = process.env.DEMO_MODE === 'true';

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Forward pathname header on every request so server layouts can highlight
  // the active tab/link without client-side JS.
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname);

  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p)) || pathname === '/favicon.ico') {
    return NextResponse.next({ request: { headers } });
  }
  const hasSession =
    req.cookies.get('authjs.session-token') ||
    req.cookies.get('__Secure-authjs.session-token');
  if (!hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Demo deployments auto-sign-in as the seeded fake user instead of
    // showing a sign-in screen. Self-hosters never have DEMO_MODE set.
    if (DEMO_MODE) {
      const url = new URL('/api/demo/start-session', req.nextUrl);
      url.searchParams.set('next', pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
    const url = new URL('/auth/signin', req.nextUrl);
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
