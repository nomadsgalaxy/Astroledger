import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthentication, deriveRpFromRequest } from '@/lib/webauthn';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { rpID, origin } = deriveRpFromRequest(req);
  const userId = await verifyAuthentication(await req.json(), { rpID, origin });
  if (!userId) return NextResponse.json({ error: 'Verification failed' }, { status: 401 });

  // Mint a database session compatible with NextAuth's strategy: 'database' adapter.
  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { sessionToken, userId, expires } });
  const jar = await cookies();
  jar.set('authjs.session-token', sessionToken, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', expires,
  });
  return NextResponse.json({ ok: true });
}
