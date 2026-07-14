import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// The request-scoped Prisma guard pins every SpaceNotification read/write to
// the session user, so no explicit userId filter is needed (or trusted) here.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [notifications, unread] = await Promise.all([
    prisma.spaceNotification.findMany({ orderBy: { at: 'desc' }, take: 30 }),
    prisma.spaceNotification.count({ where: { readAt: null } }),
  ]);
  return NextResponse.json({ notifications, unread });
}

// POST { action: "read", id } | { action: "read_all" }
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action === 'read_all') {
    await prisma.spaceNotification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  } else if (body.action === 'read' && body.id) {
    await prisma.spaceNotification.updateMany({ where: { id: String(body.id) }, data: { readAt: new Date() } });
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
