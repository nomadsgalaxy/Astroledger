import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { verifyRegistration, deriveRpFromRequest } from '@/lib/webauthn';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { rpID, origin } = deriveRpFromRequest(req);
    await verifyRegistration((session.user as any).id, await req.json(), { rpID, origin });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
