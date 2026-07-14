import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRegistrationOptions, deriveRpFromRequest } from '@/lib/webauthn';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id as string;
  const { rpID } = deriveRpFromRequest(req);
  const opts = await getRegistrationOptions(userId, session.user.email!, { rpID });
  return NextResponse.json(opts);
}
