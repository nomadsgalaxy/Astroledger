import { NextResponse } from 'next/server';
import { getAuthenticationOptions, deriveRpFromRequest } from '@/lib/webauthn';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { rpID } = deriveRpFromRequest(req);
  return NextResponse.json(await getAuthenticationOptions({ rpID }));
}
