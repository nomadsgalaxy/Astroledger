import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUpdateStatus } from '@/lib/updateCheck';

export const runtime = 'nodejs';

function requireAdmin(session: any) {
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'Instance administrator access is required' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await auth();
  const denied = requireAdmin(session);
  if (denied) return denied;
  return NextResponse.json(await getUpdateStatus());
}

// POST { action: "check" } — bypass the cache.
export async function POST(req: Request) {
  const session = await auth();
  const denied = requireAdmin(session);
  if (denied) return denied;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action !== 'check') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  return NextResponse.json(await getUpdateStatus(true));
}
