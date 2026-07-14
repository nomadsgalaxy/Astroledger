import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
// Initializes the demo sandbox client factory before this route provisions a
// visitor. Route-level bundling does not otherwise guarantee prisma.ts ran.
import '@/lib/prisma';
import { getSandboxClient } from '@/lib/demoSandbox';

// Auto-signs the visitor in as the seeded demo user. Gated behind
// DEMO_MODE=true so self-hosters can never trigger it accidentally.
//
// Flow:
//   1. Middleware redirects unauthenticated requests here.
//   2. We mint a session-token UUID and provision the visitor's per-session
//      sandbox SQLite file (copy of _seed.db).
//   3. We write the Session row directly into THAT sandbox (not the
//      singleton DB) - the cookie isn't set yet, so the prisma proxy would
//      fall back to the singleton and lose the row.
//   4. Set the cookie. On subsequent requests, the proxy reads the cookie
//      and routes Prisma queries to the same sandbox file.
export async function GET(req: Request) {
  if (process.env.DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'demo mode disabled' }, { status: 404 });
  }
  const url = new URL(req.url);
  const next = url.searchParams.get('next') || '/';

  // Mint cookie value first - we use it to key the sandbox AND set the cookie.
  const sessionToken = randomUUID() + '.' + randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Provision the per-visitor sandbox and write the Session row INTO it.
  // sandboxClient is fully isolated from the singleton - every subsequent
  // request from this visitor routes Prisma queries here via the cookie.
  let sandboxClient;
  try {
    sandboxClient = await getSandboxClient(sessionToken);
  } catch (e: any) {
    return NextResponse.json(
      { error: `sandbox provisioning failed: ${e.message}. Ensure prisma/sandboxes/_seed.db exists (run npm run seed:demo).` },
      { status: 503 },
    );
  }

  const demoUser = await sandboxClient.user.findUnique({ where: { email: 'demo@astroledger.app' } });
  if (!demoUser) {
    return NextResponse.json(
      { error: 'demo user not seeded in _seed.db. Run `npm run db:seed && npm run seed:demo`.' },
      { status: 503 },
    );
  }
  await sandboxClient.session.create({
    data: { sessionToken, userId: demoUser.id, expires },
  });

  // NextAuth v5 uses `authjs.session-token` (no host-only prefix on http,
  // `__Secure-` prefix on https). Match the deployed protocol.
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost  = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const isHttps = (url.protocol === 'https:') || (xfProto === 'https');
  const cookieName = isHttps ? '__Secure-authjs.session-token' : 'authjs.session-token';

  // Behind Cloudflare Tunnel `req.url` is `http://localhost:5055/...`, so
  // `new URL(next, req.url)` would 307 the visitor to localhost. Honor the
  // forwarded host/proto so we redirect to the public origin.
  const baseOrigin = xfHost ? `${isHttps ? 'https' : 'http'}://${xfHost}` : new URL('/', req.url).origin;
  const redirectTo = new URL(next, baseOrigin);

  const res = NextResponse.redirect(redirectTo);
  res.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    expires,
    path: '/',
  });
  return res;
}
