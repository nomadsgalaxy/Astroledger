import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { RANGE_COOKIE, isRangeKey, DEFAULT_RANGE } from '@/lib/timeRange';
// (this route runs in Node runtime; cookies/next-headers are fine here)

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { key } = await req.json().catch(() => ({ key: null }));
  const next = isRangeKey(key) ? key : DEFAULT_RANGE;
  const c = await cookies();
  c.set(RANGE_COOKIE, next, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true, key: next });
}
