import { NextResponse } from 'next/server';
import { createLinkToken, plaidEnabled } from '@/lib/plaid';

export const runtime = 'nodejs';

export async function POST() {
  if (!plaidEnabled()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 400 });
  try {
    const token = await createLinkToken();
    return NextResponse.json({ link_token: token });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
