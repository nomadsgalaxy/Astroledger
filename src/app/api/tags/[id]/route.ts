import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureModifierParent } from '@/lib/tags';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (body.color === null || typeof body.color === 'string') data.color = body.color;
  if (body.kind === 'primary' || body.kind === 'secondary') data.kind = body.kind;
  if (body.parentId === null || typeof body.parentId === 'string') {
    // Prevent making a tag its own parent or creating a cycle through children
    if (body.parentId === id) return NextResponse.json({ error: 'Cannot parent to self' }, { status: 400 });
    if (typeof body.parentId === 'string') {
      const target = await prisma.tag.findUnique({ where: { id: body.parentId } });
      if (target?.parentId === id) return NextResponse.json({ error: 'Cycle detected' }, { status: 400 });
    }
    data.parentId = body.parentId;
  }
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  // After the patch, the tag must not end up as an orphan secondary. If
  // the caller is setting kind=secondary or parentId=null (or both), check
  // the final shape against the existing row and auto-assign Modifier if
  // we'd leave it orphaned.
  const current = await prisma.tag.findUnique({ where: { id }, select: { kind: true, parentId: true } });
  if (!current) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  const finalKind = (typeof data.kind === 'string' ? data.kind : current.kind) as 'primary' | 'secondary';
  const finalParentId = 'parentId' in data ? (data.parentId as string | null) : current.parentId;
  if (finalKind === 'secondary' && !finalParentId) {
    data.parentId = await ensureModifierParent();
  }
  try {
    const tag = await prisma.tag.update({ where: { id }, data });
    return NextResponse.json({ tag });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  // Children get their parentId nulled (onDelete: SetNull in schema). Attachments
  // to transactions/subscriptions are removed via implicit m:n cascade.
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
