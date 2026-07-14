// Opt-in Gmail authorization - kicks the user to Google's consent screen
// requesting the gmail.readonly scope. `include_granted_scopes=true` preserves
// existing grants so this only adds to (never replaces) the session.
//
// Auth.js receives the callback at /api/auth/callback/google like normal; it
// will update the existing Account row with the new access_token + scope.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL('/auth/signin', process.env.NEXTAUTH_URL!));

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.NEXTAUTH_URL}/api/auth/callback/google`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/gmail.readonly');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('login_hint', session.user.email!);
  return NextResponse.redirect(url);
}
