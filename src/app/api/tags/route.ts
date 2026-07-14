import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listTagsFlat, ensureModifierParent } from '@/lib/tags';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ tags: await listTagsFlat() });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    name?: string; color?: string | null; kind?: 'primary' | 'secondary';
    parentId?: string | null; sortOrder?: number;
  };
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const kind: 'primary' | 'secondary' = body.kind === 'primary' ? 'primary' : 'secondary';
  // Secondaries must have a parent. If the caller didn't pick one, drop the
  // tag into the catch-all Modifier primary so the database invariant holds.
  let parentId = body.parentId ?? null;
  if (kind === 'secondary' && !parentId) {
    parentId = await ensureModifierParent();
  }
  try {
    const tag = await prisma.tag.create({
      data: {
        name: body.name.trim(),
        color: body.color ?? null,
        kind,
        parentId,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return NextResponse.json({ tag });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
